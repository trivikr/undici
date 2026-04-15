'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

test('Request defers parsing response headers and trailers until accessed', (t) => {
  const utilPath = require.resolve('../../lib/core/util')
  const requestPath = require.resolve('../../lib/core/request')
  const util = require(utilPath)
  const originalParseHeaders = util.parseHeaders

  delete require.cache[requestPath]
  util.parseHeaders = () => {
    throw new Error('parseHeaders should not be called eagerly')
  }

  const Request = require(requestPath)

  t.after(() => {
    util.parseHeaders = originalParseHeaders
    delete require.cache[requestPath]
  })

  const request = new Request('http://localhost:3000', {
    path: '/',
    method: 'GET'
  }, {
    onRequestStart () {},
    onResponseStart (controller, statusCode) {
      assert.strictEqual(statusCode, 200)
      assert.deepEqual(controller.rawHeaders, [
        Buffer.from('content-type'),
        Buffer.from('text/plain')
      ])
    },
    onResponseData () {},
    onResponseEnd (controller) {
      assert.deepEqual(controller.rawTrailers, [
        Buffer.from('x-trailer'),
        Buffer.from('value')
      ])
    },
    onResponseError (_controller, err) {
      throw err
    }
  })

  request.onRequestStart(() => {}, {})
  request.onResponseStart(200, [
    Buffer.from('content-type'),
    Buffer.from('text/plain')
  ], () => {}, 'OK')
  request.onResponseEnd([
    Buffer.from('x-trailer'),
    Buffer.from('value')
  ])
})
