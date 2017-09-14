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
  constructor (options) {
    if (!options.space) throw new Error('required: options.space')
    this.opt = options
    let path = resolve(appRoot.path, 'cache', `contentful-${options.space}.db`)
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
  count () {
    let defer = vow.defer()
    this.db.count({}, (err, count) => {
      if (err) defer.reject(err)
      defer.resolve(count)
    })
    return defer.promise()
  }
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
  getCollection (query = {}, resolveDepth = 1) {
    let collection = {}
    return promiseSpool({
      fetch: () => {
        let defer = vow.defer()
        this.db.find(query, (err, docs) => {
          if (err) return defer.reject(err)
          // add null for end of data
          docs.push(null)
          // docs.forEach((doc) => dbg(doc.sys.contentType))
          defer.resolve(docs)
        })
        return defer.promise()
      },
      worker: (doc) => {
        return this.resolve(doc, resolveDepth)
        .then((doc) => { collection[doc.sys.id] = doc.fields })
      }
    })
    .then(() => {
      return collection
    })
  }
  resolve (fields, depth = 1) {
    let resolvers = []
    Object.keys(fields).forEach((key) => {
      if (key === 'sys') return
      if (fields[key] === null) return
      if (fields[key].sys) {
        resolvers.push(
          this.byId(fields[key].sys.id).then((doc) => {
            fields[key] = doc.fields
          })
        )
      } else if (typeof fields[key] === 'object' && depth) {
        resolvers.push(
          this.resolve(fields[key], depth - 1).then((res) => {
            fields[key] = res
          })
        )
      }
    })
    return vow.all(resolvers).then(() => fields)
  }
  byId (id) {
    let defer = vow.defer()
    this.db.findOne({'sys.id': id}, (err, doc) => {
      if (err) return defer.reject(err)
      defer.resolve(doc)
    })
    return defer.promise()
  }
}
