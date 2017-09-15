import debug from 'debug'
import vow from 'vow'
import promiseSpool from 'promise-spool'
import {
  resolve
} from 'path'
import appRoot from 'app-root-path'
import Nedb from 'nedb'
const dbg = debug('metalsmith-contentful')

export default class Cache {
  constructor (opt) {
    if (!opt.space) throw new Error('required: options.space')
    this.opt = opt
    let path = resolve(appRoot.path, 'cache', `contentful-${opt.space}.db`)
    this.db = new Nedb(path)
    this.db.loadDatabase()
  }
  /**
   * ## invalidate
   * invalidate cache
   */
  invalidate () {
    if (this.opt.cache === 'invalidate') {
      dbg('invalidating cache')
      const defer = vow.defer()
      this.db.remove({}, {multi: true}, defer.resolve.bind(defer))
      return defer.promise()
    }
  }
  requestOrCache () {
    return this.count()
    .then((count) => {
      if (this.opt.cache && count) {
        dbg('skipping request, read from cache')
        throw new Error('cache only')
      } else {
        dbg('populate cache')
      }
    })
  }
  resolveContentTypes () {
    let defer = vow.defer()
    this.db.find({'sys.type': 'Entry'}, (err, docs) => {
      if (err) return defer.reject(err)
      docs.push(null)
      promiseSpool({
        fetch: () => vow.resolve(docs),
        worker: (entry) => {
          return this.findOne({'sys.id': entry.sys.contentType.sys.id})
          .then((contentType) => {
            entry.sys.contentType = contentType
            return this.upsert(entry)
          })
        },
        concurrency: this.opt.concurrency
      })
      .then(defer.resolve.bind(defer))
    })
    return defer.promise()
  }

  /**
   * ## count
   * count cache contents
   * @return {Promise.<Number>} resolves to number of items in cache
   */
  count () {
    let defer = vow.defer()
    this.db.count({}, (err, count) => {
      if (err) defer.reject(err)
      defer.resolve(count)
    })
    return defer.promise()
  }

  /**
   * ## upsert
   * create or update doc in cache. Works for `ContentType`, `Asset`, or `Entry`
   * @param {Object} doc
   * @return {Promise}
   */
  upsert (doc) {
    let defer = vow.defer()
    this.db.update(
      {'sys.id': doc.sys.id},
      doc,
      {upsert: true},
      defer.resolve.bind(defer)
    )
    return defer.promise()
  }

  /**
   * ## findResolved
   * wrapper for find & resolveCollection combo
   */
  findResolved (query, resolveDepth, callback) {
    return this.find(query)
    .then((docs) => this.resolveCollection(docs, resolveDepth))
    .then((docs) => {
      // half assed callback implementation for numpties
      if (callback) process.nextTick(() => callback(docs))
      return docs
    })
  }

  /**
   * ## findOneResolved
   * wrapper for findOne & resolve combo
   */
  findOneResolved (query, resolveDepth, callback) {
    return this.findOne(query)
    .then((doc) => this.resolve(doc, resolveDepth))
    .then((doc) => {
      if (callback) process.nextTick(() => callback(doc))
      return doc
    })
  }

  /**
   * ## find
   * query cache for single doc
   * @param {Object} query a nedb query (see readme)
   * @param {Function} callback
   * @return {Promise.<Object>} resolves to doc
   */
  find (query) {
    let defer = vow.defer()
    this.db.find(query, (err, docs) => {
      if (err) return defer.reject(err)
      defer.resolve(docs)
    })
    return defer.promise()
  }

  /**
   * ## findOne
   * query cache for single doc
   * @param {Object} query a nedb query (see readme)
   * @param {Function} callback
   * @return {Promise.<Object>} resolves to doc
   */
  findOne (query) {
    let defer = vow.defer()
    this.db.findOne(query, (err, doc) => {
      if (err) return defer.reject(err)
      defer.resolve(doc)
    })
    return defer.promise()
  }

  /**
   * ## resolveCollection
   * supervisor for resolve
   */
  resolveCollection (docs, depth) {
    let resolved = []
    return promiseSpool({
      fetch: () => vow.resolve([...docs, null]),
      worker: (doc) => {
        return this.resolve(doc, depth)
        .then((doc) => resolved.push(doc))
      },
      concurrency: 2
    })
    .then(() => resolved)
  }

  /**
   * ## resolve
   * recursive iterator to resolve links to other items in space
   * @param {Object} doc
   * @param {Number} depth
   * @return {Promise.<Object>} resolves to doc
   */
  resolve (doc, depth) {
    let resolvers = []
    Object.keys(doc).forEach((key) => {
      if (key === 'sys') return
      if (doc[key] === null) return
      if (doc[key].sys) {
        resolvers.push(
          this.byId(doc[key].sys.id).then((child) => {
            doc[key] = child.fields
          })
        )
      } else if (typeof doc[key] === 'object' && depth) {
        resolvers.push(
          this.resolve(doc[key], depth - 1).then((res) => {
            doc[key] = res
          })
        )
      }
    })
    return vow.all(resolvers).then(() => doc)
  }

  /**
   * ## byId
   * helper for resolve to get item from cache by id
   * @param {String} id
   * @return {Promise.<Object>} resolves to doc
   */
  byId (id) {
    let defer = vow.defer()
    this.db.findOne({'sys.id': id}, (err, doc) => {
      if (err) return defer.reject(err)
      defer.resolve(doc)
    })
    return defer.promise()
  }
}
