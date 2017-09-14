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
 * @param {Object} options
 * @param {String} options.srcId classeur folder id
 * @param {String} options.destPath path under which to place files
 * @param {Object} options.userId
 * @param {String} options.apiKey
 */
function plugin (opt) {
  // if (options.cache !== undefined) cache = options.cache
  const folder = new Space(opt)
  return folder.contentful.bind(folder)
}

class Space {
  constructor (opt) {
    // sanitise & store opt
    let err
    if (!opt) err = 'no options passed'
    if (!opt.space) err = 'required option: space'
    if (!opt.accessToken) err = 'required option: opt.accessToken'
    if (!opt.resolveDepth) opt.resolveDepth = 2
    if (opt.files) {
      if (!opt.files.coerce) opt.files.coerce = (file) => file
      if (!opt.files.destPath) err = 'required option: files.destPath'
      if (!opt.files.contentType) err = 'required option: files.contentType'
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
   * ## scrape
   * retrieve data from api and store in cache
   */
  scrape () {
    return vow.resolve()
    .then(() => {
      return this.cache.count()
      .then((count) => {
        if (this.opt.cache && count) {
          dbg('skipping request, read from cache')
          throw new Error('cache only')
        } else {
          dbg('populate cache')
        }
      })
    })
    .then(() => this.retrieve('content_types'))
    .then(() => this.retrieve('entries'))
    .then(() => this.retrieve('assets'))
    .then(() => {
      this.cache.count()
      .then((count) => dbg(`retrieved ${count} items`))
    })
    .catch((err) => {
      if (err.message === 'cache only') return
    })
  }
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
      worker: this.cache.upsert.bind(this.cache),
      concurrency: this.concurrency
    })
  }
  /**
   * ## coerce
   * translate entry from contentful to something more metalsmith
   *
   * @param {Object} file - entry from contentful
   */
  coerce (file) {
    // the contentful example spaces use `body` for `content`
    if (!file.contents && file.body) file.content = file.body
    if (file.contents) file.contents = Buffer.from(file.contents)
    Object.keys(file).forEach((key) => {
      if (typeof file[key] !== 'string') return
      let date = moment(file[key])
      if (!date.isValid()) return
      file[key] = date
    })
    file.slug = slugify(file.title, {lower: true})
    file.path = join(this.opt.files.destPath, file.slug)
    file = this.opt.files.coerce(file)
    return file
  }

  /**
   * ## mergeCache
   * pull everything from cache into metalsmith files structure
   */
  makeFiles () {
    if (!this.opt.files) return
    let defer = vow.defer()
    let meta = this.metalsmith.metadata().contentful
    let query = {
      'sys.type': 'ContentType',
      'name': this.opt.files.contentType
    }
    this.cache.db.findOne(query, (err, contentType) => {
      if (err) return defer.reject(err)
      if (!contentType) {
        return defer.reject(`no content type ${this.opt.files.contentType}`)
      }
      let query = {'sys.contentType.sys.id': contentType.sys.id}
      this.cache.db.find(query, (err, docs) => {
        if (err) return defer.reject(err)
        docs.forEach((doc) => {
          let file = this.coerce(meta[doc.sys.id])
          file = this.coerce(file)
          this.files[file.path] = file
        })
        dbg(`created ${docs.length} files`)
        defer.resolve()
      })
    })
    return defer.promise()
  }
  applyMeta () {
    return this.cache.getCollection({}, this.opt.resolveDepth)
    .then((entries) => {
      this.metalsmith.metadata().contentful = entries
      dbg(`added ${Object.keys(entries).length} items to meta`)
    })
  }

}

export default plugin
export {
  plugin
}
