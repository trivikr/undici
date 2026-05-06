'use strict'

const { test, after } = require('node:test')
const { tspl } = require('@matteo.collina/tspl')
const diagnosticsChannel = require('node:diagnostics_channel')
const { Client } = require('../../..')
const { createServer } = require('node:http')

function isSocketErrorCode (code) {
  return code === 'UND_ERR_SOCKET' || code === 'ECONNRESET'
}

test('Diagnostics channel - error', (t) => {
  const assert = tspl(t, { plan: 3 })
  const server = createServer({ joinDuplicateHeaders: true }, (req, res) => {
    res.destroy()
  })
  after(server.close.bind(server))

  const createChannel = diagnosticsChannel.channel('undici:request:create')
  const errorChannel = diagnosticsChannel.channel('undici:request:error')

  const reqHeaders = {
    foo: undefined,
    bar: 'bar'
  }

  let _req

  return new Promise((resolve) => {
    server.listen(0, () => {
      const origin = `http://localhost:${server.address().port}`

      const createHandler = ({ request }) => {
        if (request.origin === origin && request.path === '/' && request.method === 'GET') {
          _req = request
        }
      }
      createChannel.subscribe(createHandler)

      const errorHandler = ({ request, error }) => {
        if (request !== _req) {
          return
        }

        assert.equal(_req, request)
        assert.ok(isSocketErrorCode(error.code), error.code)
      }
      errorChannel.subscribe(errorHandler)
      t.after(() => {
        createChannel.unsubscribe(createHandler)
        errorChannel.unsubscribe(errorHandler)
      })

      const client = new Client(origin, {
        keepAliveTimeout: 300e3
      })

      client.request({
        path: '/',
        method: 'GET',
        headers: reqHeaders
      }, (err, data) => {
        assert.ok(isSocketErrorCode(err.code), err.code)
        client.close()
        resolve()
      })
    })
  })
})
