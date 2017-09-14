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

var _fs = require('fs');

var _nedb = require('nedb');

var _nedb2 = _interopRequireDefault(_nedb);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const dbg = (0, _debug2.default)('metalsmith-contentful');

class Cache {
  constructor(options) {
    if (!options.space) throw new Error('required: options.space');
    this.opt = options;
    let path = (0, _path.resolve)(__dirname, 'cache', `${options.space}.db`);
    if ((0, _fs.existsSync)(path) && this.cache !== 'invalidate') {
      this.lastUpdated = (0, _fs.statSync)(path).mtime.toISOString();
    }
    this.db = new _nedb2.default(path);
    this.db.loadDatabase();
  }
  /**
   * ## invalidate
   * invalidate cache
   */
  invalidate() {
    if (this.opt.cache === 'invalidate') {
      dbg('invalidating cache');
      const defer = _vow2.default.defer();
      this.db.remove({}, { multi: true }, defer.resolve.bind(defer));
      return defer.promise();
    }
  }
  count() {
    let defer = _vow2.default.defer();
    this.db.count({}, (err, count) => {
      if (err) defer.reject(err);
      defer.resolve(count);
    });
    return defer.promise();
  }
  upsert(doc) {
    let defer = _vow2.default.defer();
    this.db.update({ 'sys.id': doc.sys.id }, doc, { upsert: true }, defer.resolve.bind(defer));
    return defer.promise();
  }
  getCollection(query = {}, resolveDepth = 1) {
    let collection = {};
    return (0, _promiseSpool2.default)({
      fetch: () => {
        let defer = _vow2.default.defer();
        this.db.find(query, (err, docs) => {
          if (err) return defer.reject(err);
          // add null for end of data
          docs.push(null);
          // docs.forEach((doc) => dbg(doc.sys.contentType))
          defer.resolve(docs);
        });
        return defer.promise();
      },
      worker: doc => {
        return this.resolve(doc, resolveDepth).then(doc => {
          collection[doc.sys.id] = doc.fields;
        });
      }
    }).then(() => {
      return collection;
    });
  }
  resolve(fields, depth = 1) {
    let resolvers = [];
    Object.keys(fields).forEach(key => {
      if (key === 'sys') return;
      if (fields[key] === null) return;
      if (fields[key].sys) {
        resolvers.push(this.byId(fields[key].sys.id).then(doc => {
          fields[key] = doc.fields;
        }));
      } else if (typeof fields[key] === 'object' && depth) {
        resolvers.push(this.resolve(fields[key], depth - 1).then(res => {
          fields[key] = res;
        }));
      }
    });
    return _vow2.default.all(resolvers).then(() => fields);
  }
  byId(id) {
    let defer = _vow2.default.defer();
    this.db.findOne({ 'sys.id': id }, (err, doc) => {
      if (err) return defer.reject(err);
      defer.resolve(doc);
    });
    return defer.promise();
  }
}
exports.default = Cache;