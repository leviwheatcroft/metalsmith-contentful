# metalsmith-contentful

![nodei.co](https://nodei.co/npm/metalsmith-contentful.png?downloads=true&downloadRank=true&stars=true) ![npm](https://img.shields.io/npm/v/metalsmith-contentful.svg) ![github-issues](https://img.shields.io/github/issues/leviwheatcroft/metalsmith-contentful.svg) ![stars](https://img.shields.io/github/stars/leviwheatcroft/metalsmith-contentful.svg) ![forks](https://img.shields.io/github/forks/leviwheatcroft/metalsmith-contentful.svg)

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
      contentType: 'Post'
      coerce: (file, contentful) => {
        file.author = contentful.author || 'Team'
      }
    },
    resolveDepth: 2,
    cache: process.env['NODE_ENV'] === 'production' ? 'invalidate' : true
  })
)
.build( ... )
```

### options

 * `space` {String} (required) id of contentful space you wish to scrape
 * `destPath` {String} (required) the path under which you want to place the scraped files
 * `accessToken` {String} (required) contentful accessToken
 * `query` {Object} contentful api query, to filter results
 * `parse` {Function} function to convert contentful result to metalsmith file
 * `cache` {Boolean|"invalidate"} cache mode

### cache

several modes:

 * `undefined` (default) - request files changed since last run
 * `true` - if cache exists, don't issue any requests.
 * `"invalidate"` - destroy existing cache.

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
