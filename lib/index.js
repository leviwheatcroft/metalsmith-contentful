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
  createClient
} from 'contentful'
import {
  join
} from 'path'
import slugify from 'slugify'
import Cache from './Cache'
import moment from 'moment'
import parse from 'parse-duration'
import {
  readFile,
  writeFile,
  stat
} from 'fs'

const dbg = debug('metalsmith-contentful')
const syncTokenPath = 'cache/syncToken'

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
    if (!opt.locale) opt.locale = 'en-US'
    if (opt.cache === undefined) opt.cache = true
    if (typeof opt.cache === 'string') opt.cache = parse(opt.cache)
    if (opt.files) {
      if (!opt.files.coerce) opt.files.coerce = (file) => file
      if (!opt.files.destPath) err = 'required option: files.destPath'
      if (!opt.files.query) err = 'required option: files.query'
    }
    if (err) throw new Error(err)
    this.opt = opt
    this.cache = new Cache(this.opt)
    // initialise contentful client
    this.client = createClient({
      space: opt.space,
      accessToken: opt.accessToken,
      resolveLinks: true
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
    .then(() => this.getSyncTime())
    .then((syncTime) => {
      // first run
      if (syncTime === false) {
        dbg('cache mode: first run')
        return this.sync()
      }

      // cache set to invalidate every time
      if (this.opt.cache === false) {
        dbg('cache mode: no cache')
        return this.cache.invalidate()
        .then(() => this.sync())
      }

      // cache only, no further requests
      if (
        syncTime &&
        this.opt.cache === true
      ) {
        dbg('cache mode: cache only')
        return
      }

      // time to live set
      if (
        typeof this.opt.cache === 'number' &&
        syncTime > Date.now() - this.opt.cache
      ) {
        dbg('cache mode: recent sync')
        return
      }

      // have sync token but it's older than ttl
      dbg('cache mode: refresh')
      return this.getSyncToken()
      .then((token) => this.sync(token))
    })
    .then(() => this.applyMeta())
    .then(() => this.makeFiles())
    .catch((err) => {
      dbg(err)
    })
  }

  /**
   * ## getSyncToken
   * @return {Promise}
   */
  getSyncToken () {
    let defer = vow.defer()
    readFile(syncTokenPath, (err, token) => {
      if (err) return defer.reject(err)
      defer.resolve(token)
    })
    return defer.promise()
    // file doesn't exist
    .catch(() => false)
  }

  /**
   * ## getSyncTime
   * @return {Promise.<Number>} time of last sync in ms
   */
  getSyncTime () {
    let defer = vow.defer()
    stat(syncTokenPath, (err, stat) => {
      if (err) return defer.reject(err)
      defer.resolve(stat.mtimeMs)
    })
    return defer.promise()
    // file doesn't exist
    .catch(() => false)
  }

  /**
   * ## setSyncToken
   * writes sync token to file
   * @return {Promise}
   */
  setSyncToken (token) {
    let defer = vow.defer()
    writeFile(syncTokenPath, token, defer.resolve.bind(defer))
    return defer.promise()
  }

  /**
   * ## contentTypes
   * fetch content types
   * content types aren't returned by the api. This will only happen once after
   * invalidating cache, types will not be requested or updated if they change
   * @return {Promise}
   */
  contentTypes () {
    return this.cache.haveContentTypes()
    .catch((err) => {
      if (err.message !== 'no content types') throw err
      return this.client.getContentTypes()
      .then(async (response) => {
        // dbg(response.items[0].sys)
        for (const type of response.items) await this.cache.upsert(type)
      })
    })
  }

  /**
   * ## sync
   * request updated content
   * @param {String} token sync token returned from last call
   * @return {Promise}
   */
  sync (token) {
    // ensure we have contentTypes
    return this.contentTypes()
    // sync api always includes all locales :(
    // https://www.contentful.com/developers/docs/concepts/locales/
    .then(() => this.client.sync({nextSyncToken: token, initial: !token}))
    .then(async (response) => {
      // toPlainObject still has circular refs
      response = JSON.parse(response.stringifySafe())
      await this.setSyncToken(response.nextSyncToken)
      for (const entry of response.entries) await this.cache.upsert(entry)
      for (const asset of response.assets) await this.cache.upsert(asset)
    })
  }

  /**
   * ## applyMeta
   * this gets everything from the cache, resolves it, and adds it to
   * metalsmith meta in an object keyed by contentful id
   * @return {Promise}
   */
  applyMeta () {
    return this.cache.find({})
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
    return vow.resolve()
    .then(() => {
      if (typeof query === 'string') {
        return this.cache.findByContentType(query)
      }
      return this.cache.find(query)
    })
    .then((docs) => {
      docs.forEach((doc) => {
        let file = this.coerce(doc)
        // attach to metalsmith files structure
        this.files[file.path] = file
      })
      dbg(`created ${docs.length} files`)
    })
  }

  /**
   * ## coerce
   * translate entry from contentful to something more metalsmith
   *  - also where we mangle a path
   *  - applies passed in coerce fn too
   * @param {Object} file - entry from contentful
   * @return {Object} metalsmith file
   */
  coerce (file) {
    // const { fields, sys } = file
    const {
      fields,
      sys
    } = file
    // the contentful example spaces use `body` for `content`
    if (!fields.contents && fields.body) file.contents = fields.body
    // many plugins expect `contents` to be a `Buffer`
    if (fields.contents) file.contents = Buffer.from(fields.contents)
    // convert all ISO_8601 strings to moments <-- handy!!
    Object.keys(fields).forEach((key) => {
      if (typeof fields[key] !== 'string') return
      let date = moment(fields[key], moment.ISO_8601, true)
      if (!date.isValid()) return
      fields[key] = date
    })
    // repeat for sys, un-dry but whatever
    Object.keys(sys).forEach((key) => {
      if (typeof sys[key] !== 'string') return
      let date = moment(sys[key], moment.ISO_8601, true)
      if (!date.isValid()) return
      sys[key] = date
    })
    // slug-to-the-fi
    dbg(fields.title)
    file.slug = fields.title ? slugify(fields.title) : ''
    // mangle path
    file.path = join(this.opt.files.destPath, `${file.slug}.md`)
    dbg('file.path', file.path)
    // apply passed in fn
    file = this.opt.files.coerce(file)
    return file
  }

}

export default plugin
export {
  plugin
}
