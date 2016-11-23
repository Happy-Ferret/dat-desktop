const assert = require('assert')
const encoding = require('dat-encoding')
const collect = require('collect-stream')
const liveStream = require('level-live-stream')
const fs = require('fs')
const Stats = require('hyperdrive-stats')
const sub = require('subleveldown')

module.exports = streamData

// stream data from dats into the local filesystem
// (obj, map, fn) -> null
function streamData (args, archives, cb) {
  assert.ok(args.createArchive, 'lib/live-stream: createArchive is not defined')
  assert.ok(archives, 'lib/live-stream: archives is not defined')
  assert.ok(args.db, 'lib/live-stream: db is not defined')
  assert.ok(cb, 'lib/live-stream: cb is not defined')

  liveStream(args.db, {
    gt: ['archive', null],
    lt: ['archive', undefined]
  }).on('data', data => {
    const key = data.key[1]
    const link = encoding.encode(key)

    if (data.type === 'del') {
      // TODO delete archive from hyperdrive
      // TODO close swarm
      const dat = archives[link]
      delete archives[link]
      cb()
      dat.listStream.destroy()
      dat.close(function (err) {
        if (err) console.error(err)
        dat.db.close(function (err) {
          if (err) console.error(err)
        })
      })
    } else {
      if (archives[link]) return
      const path = `${root}/${link}`
      fs.mkdir(path, () => {
        const dat = args.createArchive(Object.assign({ key }, data.value))
        dat.open(err => {
          if (err) throw err // TODO

          // TODO add to dat-js https://github.com/joehand/dat-js/issues/30
          dat.listStream = dat.archive.list({ live: true })
          dat.listStream.on('data', entry => {
            if (entry.name !== 'dat.json') return
            collect(dat.archive.createFileReadStream('dat.json'), (err, raw) => {
              if (err) return
              let json
              try {
                json = JSON.parse(raw.toString())
              } catch (err) {
                console.error('failed to parse dat.json', err)
                return
              }
              dat.title = json.title
              cb()
            })
          })
          dat.hyperStats = Stats({
            archive: dat.archive,
            db: sub(args.db, `${encoding.encode(dat.key)}-stats`)
          })
          dat.hyperStats.on('update', () => cb())

          if (dat.owner) {
            dat.share(err => {
              cb()
              if (err) throw err
            })
          } else {
            dat.download(err => {
              cb()
              if (err) throw err
            })
          }
        })

        dat.on('files-counted', () => cb())
        dat.on('archive-finalized', () => cb())
        dat.on('archive-updated', () => cb())
        dat.on('download-finished', () => cb())
        dat.on('swarm-update', () => cb())
        cb()

        archives[link] = dat
      })
    }
    cb()
  })
}