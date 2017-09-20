import contentful from '../lib'
import {
  back as nockBack
} from 'nock'
import config from 'config'
import Metalsmith from 'metalsmith'
import assert from 'assert'
import debug from 'debug'
// import { createClient } from 'contentful'
const dbg = debug('metalsmith-contentful')
import sinon from 'sinon'
import http from 'http'
import {
  createClient
} from 'contentful'
import resolveResponse from 'contentful-resolve-response'
import cloneDeep from 'lodash.clonedeep'
import {
  detailedDiff as diff
} from 'deep-object-diff'
import vow from 'vow'

// import debug from 'debug'
// const dbg = debug('metalsmith-google-drive')

nockBack.setMode('record')
nockBack.fixtures = 'test/fixtures/scrape'

describe('metalsmith-contentful', () => {
  beforeEach(function () {
    // create spy
    // sinon.spy(cloudinary.api, 'resources')
    this.requestSpy = sinon.spy(http, 'request')
  })
  afterEach(function () {
    this.requestSpy.restore()
    // cloudinary.api.resources.restore()
  })
  it('should be able to scrape a space', (done) => {
    nockBack('scrape', (writeRequests) => {
      Metalsmith('test/fixtures/scrape')
      .use(contentful(Object.assign(
        {
          files: {
            destPath: 'articles',
            query: 'Post'
          },
          invalidateCache: true
        },
        config.get('metalsmith-contentful')
      )))
      .use((files, metalsmith) => {
        // dbg(metalsmith.metadata().contentful)
        let file = files['articles/down-the-rabbit-hole.md']
        assert.ok(file)
        assert.equal(file.category[0].title, 'Literature') // resolved
        assert.ok(Object.keys(metalsmith.metadata().contentful).length)
      })
      .build((err, files) => {
        if (err) return done(err)
        writeRequests()
        done()
      })
    })
  }).timeout(0)
  it('should read from cache', function (done) {
    let test = this
    Metalsmith('test/fixtures/scrape')
    .use(contentful(Object.assign(
      {
        files: {
          destPath: 'articles',
          query: 'Post'
        },
        invalidateCache: false
      },
      config.get('metalsmith-contentful')
    )))
    .use((files, metalsmith) => {
      let file = files['articles/down-the-rabbit-hole.md']
      assert.equal(test.requestSpy.callCount, 0)
      assert.ok(file)
      assert.equal(file.category[0].title, 'Literature') // resolved
      assert.ok(Object.keys(metalsmith.metadata().contentful).length)
    })
    .build((err, files) => {
      if (err) return done(err)
      done()
    })
  }).timeout(0)
  it('should make objects consistent with other modules', function (done) {
    nockBack('consistent', (writeRequests) => {
      let client = createClient(Object.assign(
        { resolveLinks: false },
        config.get('metalsmith-contentful'),
      ))
      let contentfulResolveResponse
      let metalsmithContentful
      client.getEntries({'sys.id': '1asN98Ph3mUiCYIYiiqwko'})
      .then((entry) => {
        entry = cloneDeep(entry)
        resolveResponse(entry)
        contentfulResolveResponse = entry.items[0]
        // dbg(entry.items[0].fields.author)
      })
      .catch((err) => dbg(err))
      .then(() => {
        let defer = vow.defer()
        Metalsmith('test/fixtures/scrape')
        .use(contentful(config.get('metalsmith-contentful')))
        .use((files, metalsmith) => {
          let meta = metalsmith.metadata()
          return meta.contentful.findOne({'sys.id': '1asN98Ph3mUiCYIYiiqwko'})
          .then((entry) => {
            metalsmithContentful = entry[0]
          })
        })
        .build((err, files) => {
          if (err) return defer.reject(err)
          defer.resolve()
        })
        return defer.promise()
      })
      .then(() => {
        dbg(diff(
          contentfulResolveResponse,
          metalsmithContentful
        ))
        dbg(diff(
          contentfulResolveResponse.sys.contentType,
          metalsmithContentful.sys.contentType
        ))
      })
    })
  }).timeout(0)
})
