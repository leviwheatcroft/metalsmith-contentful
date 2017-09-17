import contentful from '../lib'
import {
  back as nockBack
} from 'nock'
import config from 'config'
import Metalsmith from 'metalsmith'
import assert from 'assert'
import debug from 'debug'
import { createClient } from 'contentful'
const dbg = debug('metalsmith-contentful')

// import debug from 'debug'
// const dbg = debug('metalsmith-google-drive')

nockBack.setMode('record')
nockBack.fixtures = 'test/fixtures/scrape'

describe('metalsmith-contentful', () => {
  beforeEach(() => {
    // create spy
    // sinon.spy(cloudinary.api, 'resources')
  })
  afterEach(() => {
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
          cache: 'invalidate'
        },
        config.get('metalsmith-contentful')
      )))
      .use((files, metalsmith) => {
        let file = files['articles/seven-tips-from-ernest-hemingway-on-how-to-write-fiction.md']
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
})
