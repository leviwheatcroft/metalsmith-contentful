'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _debug = require('debug');

var _debug2 = _interopRequireDefault(_debug);

var _vow = require('vow');

var _vow2 = _interopRequireDefault(_vow);

var _promiseSpool = require('promise-spool');

var _promiseSpool2 = _interopRequireDefault(_promiseSpool);

var _path = require('path');

var _appRootPath = require('app-root-path');

var _appRootPath2 = _interopRequireDefault(_appRootPath);

var _nedb = require('nedb');

var _nedb2 = _interopRequireDefault(_nedb);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const dbg = (0, _debug2.default)('metalsmith-contentful');

class Cache {
  constructor(opt) {
    if (!opt.space) throw new Error('required: options.space');
    this.opt = opt;
    let path = (0, _path.resolve)(_appRootPath2.default.path, 'cache', `contentful-${opt.space}.db`);
    this.db = new _nedb2.default(path);
    this.db.loadDatabase();
  }
  /**
   * ## invalidate
   * invalidate cache
   */
  invalidate() {
    if (this.opt.invalidateCache) {
      dbg('invalidating cache');
      const defer = _vow2.default.defer();
      this.db.remove({}, { multi: true }, defer.resolve.bind(defer));
      return defer.promise();
    }
  }
  requestOrCache() {
    return this.count().then(count => {
      if (!this.opt.invalidateCache && count) {
        dbg('skipping request, read from cache');
        throw new Error('cache only');
      } else {
        dbg('populate cache');
      }
    });
  }
  // resolveContentTypes () {
  //   let defer = vow.defer()
  //   this.db.find({'sys.type': 'Entry'}, (err, docs) => {
  //     if (err) return defer.reject(err)
  //     docs.push(null)
  //     promiseSpool({
  //       fetch: () => vow.resolve(docs),
  //       worker: (entry) => {
  //         let defer = vow.defer()
  //         this.db.findOne(
  //           {'sys.id': entry.sys.contentType.sys.id},
  //           (err, contentType) => {
  //             if (err) return defer.reject(err)
  //             entry.sys.contentType = contentType
  //             this.upsert(entry)
  //             .then(defer.resolve.bind(defer))
  //           }
  //         )
  //       },
  //       concurrency: this.opt.concurrency
  //     })
  //     .then(defer.resolve.bind(defer))
  //   })
  //   return defer.promise()
  // }

  /**
   * ## count
   * count cache contents
   * @return {Promise.<Number>} resolves to number of items in cache
   */
  count() {
    let defer = _vow2.default.defer();
    this.db.count({}, (err, count) => {
      if (err) defer.reject(err);
      defer.resolve(count);
    });
    return defer.promise();
  }

  upsertCollection(docs) {
    return _vow2.default.all(docs.map(doc => this.upsert(doc)));
  }

  /**
   * ## upsert
   * create or update doc in cache. Works for `ContentType`, `Asset`, or `Entry`
   * @param {Object} doc
   * @return {Promise}
   */
  upsert(doc) {
    let defer = _vow2.default.defer();
    this.db.update({ 'sys.id': doc.sys.id }, doc, { upsert: true }, (err, res) => {
      // if (err) dbg(err)
      if (err) return defer.reject(err);
      defer.resolve(res);
    }
    // defer.resolve.bind(defer)
    );
    return defer.promise();
  }

  /**
   * ## find
   *
   */
  find(query, resolveDepth, callback) {
    let defer = _vow2.default.defer();
    this.db.find(query, (err, docs) => {
      if (err) return defer.reject(err);
      defer.resolve(docs);
    });
    return defer.promise().then(docs => {
      if (resolveDepth) return this.resolveCollection(docs, resolveDepth);
      return docs;
    }).then(docs => {
      // half assed callback implementation for numpties
      if (callback) process.nextTick(() => callback(docs));
      return docs;
    });
  }

  findByContentType(contentType, resolveDepth, callback) {
    return _vow2.default.resolve().then(() => {
      return this.findOne({
        'sys.type': 'ContentType',
        'name': contentType
      });
    }).then(contentType => {
      let query = { 'sys.contentType.sys.id': contentType.sys.id };
      return this.find(query, resolveDepth);
    }).catch(err => dbg(err));
  }

  /**
   * ## findOne
   *
   */
  findOne(query, resolveDepth, callback) {
    let defer = _vow2.default.defer();
    this.db.findOne(query, (err, doc) => {
      if (err) return defer.reject(err);
      defer.resolve(doc);
    });
    return defer.promise().then(doc => {
      if (!doc) throw new Error('no doc');
      delete doc._id;
      if (resolveDepth) return this.resolve(doc, resolveDepth);
      return doc;
    }).catch(err => {
      if (err.message === 'no doc') return;
      throw err;
    }).then(doc => {
      if (callback) process.nextTick(() => callback(doc));
      return doc;
    });
  }

  /**
   * ## resolveCollection
   * supervisor for resolve
   */
  resolveCollection(docs, depth) {
    let resolved = [];
    return (0, _promiseSpool2.default)({
      fetch: () => _vow2.default.resolve([...docs, null]),
      worker: doc => {
        return this.resolve(doc, depth).then(doc => resolved.push(doc));
      },
      concurrency: 2
    }).then(() => resolved);
  }

  /**
   * ## resolve
   * recursive iterator to resolve links to other items in space
   * @param {Object} doc
   * @param {Number} depth
   * @return {Promise.<Object>} resolves to doc
   */
  resolve(doc, depth) {
    if (!doc) {
      dbg(doc);
      throw new Error('resolve called with no doc');
    }
    let resolvers = [];
    const isLink = function isLink(object) {
      return object && object.sys && object.sys.type === 'Link';
    };
    Object.keys(doc).forEach(key => {
      if (isLink(doc[key])) {
        resolvers.push(this.findOne({ 'sys.id': doc[key].sys.id }, depth - 1).then(child => {
          // fail silently if target id doesn't exist
          // for example, we don't have the 'space' itself
          if (child) doc[key] = child;
        }));
      } else if (doc[key] && typeof doc[key] === 'object' && depth > 0) {
        resolvers.push(this.resolve(doc[key], depth - 1).then(res => {
          doc[key] = res;
        }));
      }
    });
    return _vow2.default.all(resolvers).then(() => {
      return doc;
    });
  }

  /**
   * ## byId
   * helper for resolve to get item from cache by id
   * @param {String} id
   * @return {Promise.<Object>} resolves to doc
   */
  // byId (id) {
  //   let defer = vow.defer()
  //   this.db.findOne({'sys.id': id}, (err, doc) => {
  //     if (err) return defer.reject(err)
  //     defer.resolve(doc)
  //   })
  //   return defer.promise()
  // }
}
exports.default = Cache;