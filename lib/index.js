/**
 * ## overview
 *  - scrape *everything* from space (no queries / filters)
 *  - store space in cache
 *  - expose everything from cache in metadata `contentful` property, along
 *    with `find` and `findOne`
 *  - add files to metalsmith `files` structure according to query
 */

import debug from 'debug'
import vow from 'vow'
import {
  createClient as flashheart
} from 'flashheart'
import promiseSpool from 'promise-spool'
import {
  join
} from 'path'
import slugify from 'slugify'
import Cache from './Cache'
import moment from 'moment'

const dbg = debug('metalsmith-contentful')

/**
 * ### plugin
 * wrapper to expose plugin
 *
 * @param {Object} opt
 * @param {String} opt.space (reqd) contentful space id
 * @param {String} opt.accessToken (reqd) contentful access token
 * @param {Number} opt.resolveDepth (default: 2) recursion for resolving links
 * @param {Number} opt.concurrency (default: 3) concurrent cache ops (memory rw)
 * @param {Object} opt.files (default: {}) file creation opts
 * @param {String} opt.files.destPath (reqd) path under which to place files
 * @param {Function} opt.files.coerce (default: (file) => file) see Space.coerce
 * @param {String|Object} options.files.query (reqd) files to create
 */
function plugin (opt) {
  const folder = new Space(opt)
  return folder.contentful.bind(folder)
}

class Space {
  /**
   * ## constructor
   * see params for `plugin`
   */
  constructor (opt) {
    let err
    if (!opt) err = 'no options passed'
    if (!opt.space) err = 'required option: space'
    if (!opt.accessToken) err = 'required option: opt.accessToken'
    if (!opt.resolveDepth) opt.resolveDepth = 2
    if (!opt.concurrency) opt.concurrency = 3
    if (opt.files) {
      if (!opt.files.coerce) opt.files.coerce = (file) => file
      if (!opt.files.destPath) err = 'required option: files.destPath'
      if (!opt.files.query) err = 'required option: files.query'
    }
    if (err) throw new Error(err)
    this.opt = opt
    this.cache = new Cache(this.opt)
    // initialise contentful client
    this.client = flashheart({
      defaults: {qs: {access_token: opt.accessToken}}
    })
  }
  /**
   * ## contentful
   * this is the plugin function exposed to metalsmith
   *
   * @param {Object} files metalsmith files structure
   * @param {Object} metalsmith
   * @return {Promise}
   */
  contentful (files, metalsmith) {
    this.files = files
    this.metalsmith = metalsmith
    return vow.resolve()
    .then(() => this.cache.invalidate())
    .then(() => this.scrape())
    .then(() => this.applyMeta())
    .then(() => this.makeFiles())
    .catch((err) => {
      dbg(err)
    })
  }

  /**
   * ## scrape
   * oversees operation of scraping entire space to cache
   * by design, there's no options to limit what get's pulled down
   * @return {Promise}
   */
  scrape () {
    return vow.resolve()
    .then(() => this.cache.requestOrCache())
    .then(() => this.retrieve('content_types'))
    .then(() => this.retrieve('entries'))
    .then(() => this.retrieve('assets'))
    .then(() => this.cache.resolveContentTypes())
    .then(() => {
      this.cache.count()
      .then((count) => dbg(`retrieved ${count} items`))
    })
    .catch((err) => {
      if (err.message === 'cache only') return
      throw err
    })
  }

  /**
   * ## retrieve
   * async structure to drain everything from an endpoint with consecutive
   * requests if required. Should play nice with large spaces.
   * contentful api is fairly consistent so this works with all relevant
   * endpoints
   * @param {String} endpoint
   * @return {Promise}
   */
  retrieve (endpoint) {
    return promiseSpool({
      fetch: (retrieved) => {
        let url = `/spaces/${this.opt.space}/${endpoint}`
        return this.fetch(url, {qs: {skip: retrieved}})
        .then((res) => {
          if (retrieved + res.items.length >= res.total) res.items.push(null)
          return res.items
        })
      },
      // each item returned is simply added to cache
      worker: this.cache.upsert.bind(this.cache),
      concurrency: this.concurrency
    })
  }

  /**
   * ## fetch
   * manage a single request from contentful
   * @param {String} url
   * @param {Object} query
   * @return {Promise.<Response>}
   */
  fetch (url, query) {
    let defer = vow.defer()
    this.client.get(
      `https://cdn.contentful.com/${url}`,
      query,
      (err, res) => {
        if (err) return defer.reject(err)
        defer.resolve(res)
      }
    )
    return defer.promise()
  }

  /**
   * ## applyMeta
   * this gets everything from the cache, resolves it, and adds it to
   * metalsmith meta in an object keyed by contentful id
   * @return {Promise}
   */
  applyMeta () {
    return this.cache.find({}, this.opt.resolveDepth)
    .then((docs) => {
      let entries = {
        find: this.cache.find.bind(this.cache),
        findOne: this.cache.findOne.bind(this.cache)
      }
      // key meta by id, omit `sys`
      docs.forEach((doc) => { entries[doc.sys.id] = doc.fields })
      this.metalsmith.metadata().contentful = entries
      dbg(`added ${Object.keys(entries).length - 2} items to meta`)
    })
  }

  /**
   * ## makeFiles
   * query entries and construct metalsmith files from them
   * @return {Promise}
   */
  makeFiles () {
    if (!this.opt.files) return
    let query = this.opt.files.query
    // for convenience, you can just pass a contentType instead of a query
    if (typeof query === 'string') query = {'sys.contentType.name': query}
    return this.cache.find(query, this.opt.resolveDepth)
    .then((docs) => {
      docs.forEach((doc) => {
        let file = this.coerce(doc.fields)
        // attach to metalsmith files structure
        this.files[file.path] = file
      })
      dbg(`created ${docs.length} files`)
    })
  }

  /**
   * ## coerce
   * translate entry from contentful to something more metalsmith
   *  - also where we magle a path
   *  - applies passed in coerce fn too
   * @param {Object} file - entry from contentful
   * @return {Object} metalsmith file
   */
  coerce (file) {
    // the contentful example spaces use `body` for `content`
    if (!file.contents && file.body) file.content = file.body
    // many plugins expect `contents` to be a `Buffer`
    if (file.contents) file.contents = Buffer.from(file.contents)
    // convert all ISO_8601 strings to moments <-- handy!!
    Object.keys(file).forEach((key) => {
      if (typeof file[key] !== 'string') return
      let date = moment(file[key], moment.ISO_8601, true)
      if (!date.isValid()) return
      file[key] = date
    })
    // slug-to-the-fi, preseciptive, but consumers can easily over write
    file.slug = slugify(file.title, {lower: true})
    // mangle path
    file.path = join(this.opt.files.destPath, `${file.slug}.md`)
    // apply passed in fn
    file = this.opt.files.coerce(file)
    return file
  }

}

export default plugin
export {
  plugin
}
