'use strict'

const { tspl } = require('@matteo.collina/tspl')
const { test, after } = require('node:test')
const { createServer } = require('node:http')
const { once } = require('node:events')
const { pipeline: undiciPipeline, Client, interceptors } = require('..')
const { pipeline: streamPipelineCb } = require('node:stream')
const { promisify } = require('node:util')
const { createReadable, createWritable } = require('./utils/stream')
const { startRedirectingServer } = require('./utils/redirecting-servers')

const streamPipeline = promisify(streamPipelineCb)
const redirect = interceptors.redirect

async function startRedirectingAfterRequestBodyServer () {
  const server = createServer({ joinDuplicateHeaders: true }, async (req, res) => {
    req.resume()
    await once(req, 'end')

    const serverRoot = `localhost:${server.address().port}`

    res.statusCode = 302
    res.setHeader('Connection', 'close')
    res.setHeader('Location', `http://${serverRoot}/302/1`)
    res.end('')
  })

  server.listen(0)
  await once(server, 'listening')

  after(() => new Promise(resolve => {
    server.closeAllConnections()
    server.close(resolve)
  }))

  return `localhost:${server.address().port}`
}

test('should not follow redirection by default if not using RedirectAgent', async t => {
  t = tspl(t, { plan: 3 })

  const body = []
  const serverRoot = await startRedirectingServer()

  await streamPipeline(
    createReadable('REQUEST'),
    undiciPipeline(`http://${serverRoot}/`, {
      dispatcher: new Client(`http://${serverRoot}/`).compose(redirect({ maxRedirections: null }))
    }, ({ statusCode, headers, body }) => {
      t.strictEqual(statusCode, 302)
      t.strictEqual(headers.location, `http://${serverRoot}/302/1`)

      return body
    }),
    createWritable(body)
  )

  t.strictEqual(body.length, 0)
})

test('should not follow redirects when using RedirectAgent within pipeline', async t => {
  t = tspl(t, { plan: 3 })

  const body = []
  const serverRoot = await startRedirectingAfterRequestBodyServer()

  await streamPipeline(
    createReadable('REQUEST'),
    undiciPipeline(`http://${serverRoot}/`, { dispatcher: new Client(`http://${serverRoot}/`).compose(redirect({ maxRedirections: 1 })) }, ({ statusCode, headers, body }) => {
      t.strictEqual(statusCode, 302)
      t.strictEqual(headers.location, `http://${serverRoot}/302/1`)

      return body
    }),
    createWritable(body)
  )

  t.strictEqual(body.length, 0)
})
