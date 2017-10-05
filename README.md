# metalsmith-contentful

![nodei.co](https://nodei.co/npm/metalsmith-contentful.png?downloads=true&downloadRank=true&stars=true)

![npm](https://img.shields.io/npm/v/metalsmith-contentful.svg) ![github-issues](https://img.shields.io/github/issues/leviwheatcroft/metalsmith-contentful.svg) ![stars](https://img.shields.io/github/stars/leviwheatcroft/metalsmith-contentful.svg) ![forks](https://img.shields.io/github/forks/leviwheatcroft/metalsmith-contentful.svg)

[metalsmith](https://metalsmith.io) plugin to scrape content from contentful

This is not the official [contentful-metalsmith][contentful-metalsmith] plugin.

Highlights:

 * caches contentful data
 * query from metalsmith build call, not from file yaml meta

See the [annotated source][annotated source] or [github repo][github repo]

## motivation

I really need caching from remote apis to speed up the metalsmith build process. I couldn't see a way to modify the official plugin to support caching so made something from scratch.

## install

`npm i --save github:leviwheatcroft/metalsmith-contentful`

## overview

A contentful space contains `entries` as defined by `content_types`, and `assets` for images or whatever. This plugin scrapes *all* these items from a given space.

All items are exposed at `metalsmith.metadata().contentful` in an object keyed by contentful id

`metalsmith.metadata().contentful` also exposes `find` and `findOne` functions allowing you to query the items.

The plugin also creates files in the metalsmith files array.

### example

```javascript
Metalsmith('src')
.use(
  contentful({
    space: 'aH7WHo2REFrZ6CHbGZx4',
    accessToken: '9aXKQnP2UjjEeTTUcyGCMAOmhn4Vsf8u',
    files: {
      destPath: 'articles',
      query: 'Post'
    },
    cache: process.env['NODE_ENV'] !== 'production'
  })
)
.build( ... )
```

### options

 * `space` {String} (required) id of contentful space you wish to scrape
 * `destPath` {String} (required) the path under which you want to place the   scraped files
 * `cache` {Boolean|String} (default: `true`) cache mode
 * `locale` {String} (default: `en-US`) locale
 * `files` {Object} (optional) [file creation]() opts
 * `files.destPath` {String} path under which to place files
 * `files.coerce` {Function} fn to convert files
 * `files.query` {String|Object} [query](#queries) for files to create

### contentful data structure

Finding different properties in the returned data may not be intuitive. If you're struggling you should try [metalsmith-debug-ui][metalsmith-debug-ui], and take a look at the data structures returned by the [contentful api][contentful api].

### cache modes

 * *full cache* `true` - in this mode everything will be pulled down once, and no further requests to the contentful api will be issued in future builds
 * *no cache* `false` - this invalidates cache every build
 * *sync* `{string}` - any string understood by [parse-duration][parse-duration]. Will use the sync api to request updated items if last sync is older than the duration specified.

### queries

This plugin doesn't use contentful queries, it just pulls down everything and stores it in your cache. You can then query your cache with [nedb queries][nedb queries]. Items are stored in cache in the same form they're retrieved from contentful.

The `contentful` property in metadata exposes two functions `find` and `findOne`. Consider
the following example. Both return promises which resolve to the query result, and both accept a single parameter: a nedb search query.

Usage example:

```javascript
Metalsmith('src')
.use(
  contentful({
    space: 'aH7WHo2HQFrX5CHbGZx4',
    accessToken: '9aXKQnP2UjjEeSSUcyGCMAOhnm4Vsf8u'
  })
)
.use((files, metalsmith) => {
  let query = {'fields.file.contentType': /^image/}
  return metalsmith.metadata().contentful.find(query)
  .then((images) => {
    let imageUrls = images.map((image) => image.fields.file.url)
    metalsmith.metadata().contentfulImageUrls = imageUrls
  })
})
.build( ... )
```

### file creation

This behaviour is optional. If you pass in a `files` property files will be created in the metalsmith files structure.

The `query` option determines what items from the contentful space will be used to create files, it can either be a [nedb query][nedb queries], or the name of a ContentType.

`destPath` determines the root path under which the files will be created. All files are created with a .md extension to allow for easy identification by other plugins.

The plugin makes a good attempt at creating a metalsmith file, but depending on your space configuration you may need to augment it with a custom `coerce` function. For example, the demo contentful spaces use a `body` field for contents (but `contents` will work too). If you use something else like `article` then you'll need to map that to `contents` yourself, as shown.

```javascript
Metalsmith('src')
.use(
  contentful({
    space: 'aH7WHo2REFrZ6CHbGZx4',
    accessToken: '9aXKQnP2UjjEeTTUcyGCMAOmhn4Vsf8u',
    files: {
      destPath: 'articles',
      query: 'Post',
      coerce: (file) => {
        file.contents = Buffer.from(file.article)
        return file
      }
    }
  })
)
.build( ... )
```

### content types
These will only be retrieved once after cache is invalidated, so if you're using sync mode, and change or add content types, you'll need to invalidate your cache to pull down the updated content types.

### Author

Levi Wheatcroft <levi@wht.cr>

### Contributing

Contributions welcome; Please submit all pull requests against the master
branch.

### License

 - **MIT** : http://opensource.org/licenses/MIT

[annotated source]: https://leviwheatcroft.github.io/metalsmith-contentful "fancy annotated source"
[github repo]: https://github.com/leviwheatcroft/metalsmith-contentful "github repo"
[contentful-metalsmith]: https://github.com/contentful/contentful-metalsmith "official contentful-metalsmith plugin"
[nedb queries]: https://github.com/louischatriot/nedb#basic-querying "nedb readme"
[metalsmith-debug-ui]: https://github.com/leviwheatcroft/metalsmith-debug-ui "metalsmith-debug-ui repo"
[contentful api]: https://www.contentful.com/developers/docs/references/content-delivery-api/ "contentful api"
[parse-duration]: https://www.npmjs.com/package/parse-duration "parse-duration repo"
