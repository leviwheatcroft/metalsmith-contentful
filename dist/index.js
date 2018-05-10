'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.plugin = undefined;

var _debug = require('debug');

var _debug2 = _interopRequireDefault(_debug);

var _vow = require('vow');

var _vow2 = _interopRequireDefault(_vow);

var _contentful = require('contentful');

var _path = require('path');

var _slugify = require('slugify');

var _slugify2 = _interopRequireDefault(_slugify);

var _Cache = require('./Cache');

var _Cache2 = _interopRequireDefault(_Cache);

var _moment = require('moment');

var _moment2 = _interopRequireDefault(_moment);

var _parseDuration = require('parse-duration');

var _parseDuration2 = _interopRequireDefault(_parseDuration);

var _fs = require('fs');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; } /**
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            * ## overview
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            *  - scrape *everything* from space (no queries / filters)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            *  - store space in cache
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            *  - expose everything from cache in metadata `contentful` property, along
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            *    with `find` and `findOne`
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            *  - add files to metalsmith `files` structure according to query
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            */

const dbg = (0, _debug2.default)('metalsmith-contentful');
const syncTokenPath = 'cache/syncToken';

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
function plugin(opt) {
  const folder = new Space(opt);
  return folder.contentful.bind(folder);
}

class Space {
  /**
   * ## constructor
   * see params for `plugin`
   */
  constructor(opt) {
    let err;
    if (!opt) err = 'no options passed';
    if (!opt.space) err = 'required option: space';
    if (!opt.accessToken) err = 'required option: opt.accessToken';
    if (!opt.locale) opt.locale = 'en-US';
    if (opt.cache === undefined) opt.cache = true;
    if (typeof opt.cache === 'string') opt.cache = (0, _parseDuration2.default)(opt.cache);
    if (opt.files) {
      if (!opt.files.coerce) opt.files.coerce = file => file;
      if (!opt.files.destPath) err = 'required option: files.destPath';
      if (!opt.files.query) err = 'required option: files.query';
    }
    if (err) throw new Error(err);
    this.opt = opt;
    this.cache = new _Cache2.default(this.opt);
    // initialise contentful client
    this.client = (0, _contentful.createClient)({
      space: opt.space,
      accessToken: opt.accessToken,
      resolveLinks: true
    });
  }
  /**
   * ## contentful
   * this is the plugin function exposed to metalsmith
   *
   * @param {Object} files metalsmith files structure
   * @param {Object} metalsmith
   * @return {Promise}
   */
  contentful(files, metalsmith) {
    this.files = files;
    this.metalsmith = metalsmith;
    return _vow2.default.resolve().then(() => this.getSyncTime()).then(syncTime => {
      // first run
      if (syncTime === false) {
        dbg('cache mode: first run');
        return this.sync();
      }

      // cache set to invalidate every time
      if (this.opt.cache === false) {
        dbg('cache mode: no cache');
        return this.cache.invalidate().then(() => this.sync());
      }

      // cache only, no further requests
      if (syncTime && this.opt.cache === true) {
        dbg('cache mode: cache only');
        return;
      }

      // time to live set
      if (typeof this.opt.cache === 'number' && syncTime > Date.now() - this.opt.cache) {
        dbg('cache mode: recent sync');
        return;
      }

      // have sync token but it's older than ttl
      dbg('cache mode: refresh');
      return this.getSyncToken().then(token => this.sync(token));
    }).then(() => this.applyMeta()).then(() => this.makeFiles()).catch(err => {
      dbg(err);
    });
  }

  /**
   * ## getSyncToken
   * @return {Promise}
   */
  getSyncToken() {
    let defer = _vow2.default.defer();
    (0, _fs.readFile)(syncTokenPath, (err, token) => {
      if (err) return defer.reject(err);
      defer.resolve(token);
    });
    return defer.promise()
    // file doesn't exist
    .catch(() => false);
  }

  /**
   * ## getSyncTime
   * @return {Promise.<Number>} time of last sync in ms
   */
  getSyncTime() {
    let defer = _vow2.default.defer();
    (0, _fs.stat)(syncTokenPath, (err, stat) => {
      if (err) return defer.reject(err);
      defer.resolve(stat.mtimeMs);
    });
    return defer.promise()
    // file doesn't exist
    .catch(() => false);
  }

  /**
   * ## setSyncToken
   * writes sync token to file
   * @return {Promise}
   */
  setSyncToken(token) {
    let defer = _vow2.default.defer();
    (0, _fs.writeFile)(syncTokenPath, token, defer.resolve.bind(defer));
    return defer.promise();
  }

  /**
   * ## contentTypes
   * fetch content types
   * content types aren't returned by the api. This will only happen once after
   * invalidating cache, types will not be requested or updated if they change
   * @return {Promise}
   */
  contentTypes() {
    var _this = this;

    return this.cache.haveContentTypes().catch(err => {
      if (err.message !== 'no content types') throw err;
      return this.client.getContentTypes().then((() => {
        var _ref = _asyncToGenerator(function* (response) {
          // dbg(response.items[0].sys)
          for (const type of response.items) yield _this.cache.upsert(type);
        });

        return function (_x) {
          return _ref.apply(this, arguments);
        };
      })());
    });
  }

  /**
   * ## sync
   * request updated content
   * @param {String} token sync token returned from last call
   * @return {Promise}
   */
  sync(token) {
    var _this2 = this;

    // ensure we have contentTypes
    return this.contentTypes()
    // sync api always includes all locales :(
    // https://www.contentful.com/developers/docs/concepts/locales/
    .then(() => this.client.sync({ nextSyncToken: token, initial: !token })).then((() => {
      var _ref2 = _asyncToGenerator(function* (response) {
        // toPlainObject still has circular refs
        response = JSON.parse(response.stringifySafe());
        yield _this2.setSyncToken(response.nextSyncToken);
        for (const entry of response.entries) yield _this2.cache.upsert(entry);
        for (const asset of response.assets) yield _this2.cache.upsert(asset);
      });

      return function (_x2) {
        return _ref2.apply(this, arguments);
      };
    })());
  }

  /**
   * ## applyMeta
   * this gets everything from the cache, resolves it, and adds it to
   * metalsmith meta in an object keyed by contentful id
   * @return {Promise}
   */
  applyMeta() {
    return this.cache.find({}).then(docs => {
      let entries = {
        find: this.cache.find.bind(this.cache),
        findOne: this.cache.findOne.bind(this.cache)
        // key meta by id, omit `sys`
      };docs.forEach(doc => {
        entries[doc.sys.id] = doc.fields;
      });
      this.metalsmith.metadata().contentful = entries;
      dbg(`added ${Object.keys(entries).length - 2} items to meta`);
    });
  }

  /**
   * ## makeFiles
   * query entries and construct metalsmith files from them
   * @return {Promise}
   */
  makeFiles() {
    if (!this.opt.files) return;
    let query = this.opt.files.query;
    // for convenience, you can just pass a contentType instead of a query
    return _vow2.default.resolve().then(() => {
      if (typeof query === 'string') {
        return this.cache.findByContentType(query);
      }
      return this.cache.find(query);
    }).then(docs => {
      docs.forEach(doc => {
        let file = this.coerce(doc);
        // attach to metalsmith files structure
        this.files[file.path] = file;
      });
      dbg(`created ${docs.length} files`);
    });
  }

  /**
   * ## coerce
   * translate entry from contentful to something more metalsmith
   *  - also where we mangle a path
   *  - applies passed in coerce fn too
   * @param {Object} file - entry from contentful
   * @return {Object} metalsmith file
   */
  coerce(file) {
    // const { fields, sys } = file
    const {
      fields
    } = file;
    // the contentful example spaces use `body` for `content`
    if (!fields.contents && fields.body) file.contents = fields.body;
    // many plugins expect `contents` to be a `Buffer`
    if (fields.contents) file.contents = Buffer.from(fields.contents);
    // convert all ISO_8601 strings to moments <-- handy!!
    Object.keys(fields).forEach(key => {
      if (typeof fields[key] !== 'string') return;
      let date = (0, _moment2.default)(fields[key], _moment2.default.ISO_8601, true);
      if (!date.isValid()) return;
      fields[key] = date;
    });
    // slug-to-the-fi
    dbg(fields.title);
    file.slug = fields.title ? (0, _slugify2.default)(fields.title) : '';
    // mangle path
    file.path = (0, _path.join)(this.opt.files.destPath, `${file.slug}.md`);
    dbg('file.path', file.path);
    // apply passed in fn
    file = this.opt.files.coerce(file);
    return file;
  }

}

exports.default = plugin;
exports.plugin = plugin;