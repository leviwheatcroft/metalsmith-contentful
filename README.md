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

I really need caching from remote apis to speed up the metalsmith build
process. I couldn't see a way to modify the official plugin to support caching
so made something from scratch.

## install

`npm i --save github:leviwheatcroft/metalsmith-contentful`

## overview

A contentful space contains `entries` as defined by `content_types`, and
`assets` for images or whatever. This plugin scrapes *all* these things from
a given space, and exposes it at `metalsmith.metadata().contentful` in an object
keyed by contentful id.

You can create files in the metalsmith array. Presently you can only do this
for all entries of a given `contentType`.


### example

```javascript
Metalsmith('src')
.use(
  contentful({
    space: 'aH7WHo2HQFrX5CHbGZx4',
    accessToken: '9aXKQnP2UjjEeSSUcyGCMAOhnm4Vsf8u',
    files: {
      destPath: 'articles',
      query: 'Post',
      coerce: (file, contentful) => {
        file.author = contentful.author || 'Team'
      }
    },
    resolveDepth: 2,
    invalidateCache: process.env['NODE_ENV'] === 'production'
  })
)
.build( ... )
```

### options

 * `space` {String} (required) id of contentful space you wish to scrape
 * `destPath` {String} (required) the path under which you want to place the
   scraped files
 * `resolveDepth` {Number} (default: 2) recursion for [resolving links]()
 * `concurrency` {Number} (default: 3) concurrent cache ops (memory rw)
 * `parse` {Function} function to convert contentful result to metalsmith file
 * `invalidateCache` {Boolean} clear cache on start
 * `files` {Object} (optional) [file creation]() opts
 * `files.destPath` {String} path under which to place files
 * `files.coerce` {Function} fn to convert files
 * `files.query` {String|Object} [query]() for files to create

### resolving links

Items in a contentful space can reference other items. By default, up to the second level of each item is resolved. You can increase this, but if you have circular references in your structure then doing so will dramatically slow things down.

### queries

This plugin doesn't use contentful queries, it just pulls down everything and
stores it in your cache. You can then query your cache with
[nedb queries][nedb queries]. Items are stored in cache in the same form
they're retrieved from contentful with 1 exception, the `sys.contentType`
property on entries, just to allow you to query by contentType more easily.
If you're struggling with queries consider using something like
[metalsmith-debug-ui][metalsmith-debug-ui] to take a look at the structure of
data stored in metadata.

The `contentful` property in metadata exposes two functions `find` and `findOne`. Consider
the following example. Both return promises which resolve to the query result, and both accept the following options:

 * query {Object} (required) nedb query
 * resolveDepth {Number} (default: 0) recursion for link resolving
 * callback {Function} (optional) if that's how you roll

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
  let resolveDepth = 3 // default is 2
  return metalsmith.metadata().contentful.find(query, resolveDepth)
  .then((images) => {
    let imageUrls = images.map((image) => image.fields.file.url)
    metalsmith.metadata().contentfulImageUrls = imageUrls
  })
})
.build( ... )
```

## Author

Levi Wheatcroft <levi@wht.cr>

## Contributing

Contributions welcome; Please submit all pull requests against the master
branch.

## License

 - **MIT** : http://opensource.org/licenses/MIT

[annotated source]: https://leviwheatcroft.github.io/metalsmith-contentful "fancy annotated source"
[github repo]: https://github.com/leviwheatcroft/metalsmith-contentful "github repo"
[contentful-metalsmith]: https://github.com/contentful/contentful-metalsmith "official contentful-metalsmith plugin"
[nedb queries]: https://github.com/louischatriot/nedb#basic-querying "nedb readme"
[metalsmith-debug-ui]: https://github.com/leviwheatcroft/metalsmith-debug-ui "metalsmith-debug-ui repo"
