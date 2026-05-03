'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { once } = require('node:events')
const { Agent, Headers, fetch, request } = require('..')

class CustomHeaders {
  * [Symbol.iterator] () {
    yield ['X-Custom', 'custom']
    yield ['X-Other', 'other']
  }
}

test('composed interceptors receive normalized request headers', async (t) => {
  const server = http.createServer((req, res) => {
    res.end()
  })

  t.after(() => server.close())
  server.listen(0)
  await once(server, 'listening')

  const seen = []
  const dispatcher = new Agent().compose((dispatch) => (opts, handler) => {
    seen.push(opts.headers)
    return dispatch(opts, handler)
  })
  const origin = `http://localhost:${server.address().port}`

  await request(origin, { dispatcher })
  await request(origin, { dispatcher, headers: ['X-Test', 'a', 'X-Test', 'b'] })
  await request(origin, { dispatcher, headers: { 'X-Test': 'a', 'X-Other': ['b', 'c'] } })
  await request(origin, { dispatcher, headers: new Headers([['X-Test', 'a'], ['X-Other', 'b']]) })
  await request(origin, { dispatcher, headers: new CustomHeaders() })
  await fetch(origin, { dispatcher, headers: new Headers([['X-Test', 'a'], ['X-Other', 'b']]) })

  assert.deepStrictEqual(seen, [
    {},
    { 'x-test': 'a, b' },
    { 'x-test': 'a', 'x-other': 'b, c' },
    { 'x-other': 'b', 'x-test': 'a' },
    { 'x-custom': 'custom', 'x-other': 'other' },
    {
      accept: '*/*',
      'accept-encoding': 'gzip, deflate',
      'accept-language': '*',
      'sec-fetch-mode': 'cors',
      'user-agent': 'undici',
      'x-other': 'b',
      'x-test': 'a'
    }
  ])
})

test('composed interceptors receive normalized query and searchParams', async (t) => {
  const seen = []
  const dispatcher = new Agent().compose((dispatch) => (opts, handler) => {
    seen.push({
      query: opts.query,
      searchParams: opts.searchParams
    })
    handler.onResponseStart(null, 200, {}, 'OK')
    handler.onResponseEnd(null, [])
    return true
  })

  await request('http://localhost', {
    dispatcher,
    query: new URLSearchParams([['a', '1'], ['a', '2'], ['b', '3']]),
    searchParams: [['c', '4'], ['c', '5']]
  })

  assert.deepStrictEqual(seen, [{
    query: { a: ['1', '2'], b: '3' },
    searchParams: { c: ['4', '5'] }
  }])
})
