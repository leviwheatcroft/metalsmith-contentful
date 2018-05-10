import debug from 'debug'
import {
  resolve
} from 'path'
import {
  datastore as nedb
} from 'nedb-promise'

const dbg = debug('metalsmith-contentful')

export default class Cache {
  constructor (opt) {
    if (!opt.space) throw new Error('required: options.space')
    this.opt = opt
    this.db = nedb({
      filename: resolve('cache', `${opt.space}.nedb`),
      autoload: true
    })
  }

  /**
   * ## invalidate
   * clear cache
   * @return {Promise}
   */
  invalidate () {
    dbg('invalidating')
    return this.db.remove({}, {multi: true})
  }

  /**
   * ## upsert
   * create or update doc in cache.
   * @param {Object} doc
   * @return {Promise}
   */
  upsert (doc) {
    return this.db.update(
      {'sys.id': doc.sys.id},
      this.setLocale(doc),
      {upsert: true}
    )
  }

  /**
   * ## find
   * @param {Object} query nedb query
   * @return {Promise.<Array>} array of docs
   */
  find (query) {
    return this.db.find(query)
  }

  /**
   * ## findOne
   * @param {Object} query nedb query
   * @return {Promise.<Object>} single doc
   */
  findOne (query) {
    return this.db.findOne(query)
  }

  /**
   * ## haveContentTypes
   * check whether content types have already been retrieved
   * @return {Promise}
   */
  haveContentTypes () {
    return this.findOne({'sys.type': 'ContentType'})
    .then((contentType) => {
      if (!contentType) throw new Error('no content types')
    })
  }

  /**
   * ## findByContentType
   * @param {Object|String} query nedb query or `contentType`
   * @return {Promise.<Array>} array of docs
   */
  findByContentType (contentType) {
    return this.findOne({'sys.type': 'ContentType', 'name': contentType})
    .then((contentType) => {
      if (!contentType) throw new Error('bad contentType, maybe clear cache?')
      return this.find({'sys.contentType.sys.id': contentType.sys.id})
    })
    .catch((err) => dbg(err))
  }

  /**
   * ## setLocale
   * @param {Object} object keyed with locales
   * @return {Object} object with locale keys replaced by content
   */
  setLocale (object) {
    let locale = this.opt.locale
    if (!object || typeof object !== 'object') return object
    Object.keys(object).forEach((key) => {
      if (key === 'sys') return
      if (object[key] === null) return
      if (typeof object[key] !== 'object') return
      if (object[key][locale]) {
        object[key] = this.setLocale(object[key][locale])
      } else if (typeof object[key] === 'object') {
        object[key] = this.setLocale(object[key])
      }
    })
    return object
  }
}
