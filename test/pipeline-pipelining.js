'use strict'

const { tspl } = require('@matteo.collina/tspl')
const { once } = require('node:events')
const { test } = require('node:test')
const { Client } = require('..')
const { createServer } = require('node:http')
const { kConnect } = require('../lib/core/symbols')
const { kBusy, kPending, kRunning } = require('../lib/core/symbols')

async function waitFor (predicate) {
  const timeout = Date.now() + 5000

  while (!predicate()) {
    if (Date.now() > timeout) {
      throw new Error('timed out waiting for pipelined requests')
    }

    await new Promise(resolve => setImmediate(resolve))
  }
}

test('pipeline pipelining', async (t) => {
  const p = tspl(t, { plan: 10 })
  const responses = []

  const server = createServer({ joinDuplicateHeaders: true }, (req, res) => {
    p.deepStrictEqual(req.headers['transfer-encoding'], undefined)
    responses.push(res)
  })

  server.listen(0)
  await once(server, 'listening')

  const client = new Client(`http://localhost:${server.address().port}`, {
    pipelining: 2
  })

  try {
    client.on('disconnect', () => {
      if (!client.closed && !client.destroyed) {
        p.fail('unexpected disconnect')
      }
    })

    await new Promise(resolve => client[kConnect](resolve))

    p.equal(client[kRunning], 0)
    const first = client.pipeline({
      method: 'GET',
      path: '/',
      blocking: false
    }, ({ body }) => body)
    const firstEnd = once(first, 'end')
    first.end().resume()
    p.equal(client[kBusy], true)
    p.deepStrictEqual(client[kRunning], 0)
    p.deepStrictEqual(client[kPending], 1)

    const second = client.pipeline({
      method: 'GET',
      path: '/',
      blocking: false
    }, ({ body }) => body)
    const secondEnd = once(second, 'end')
    second.end().resume()
    p.equal(client[kBusy], true)
    p.deepStrictEqual(client[kRunning], 0)
    p.deepStrictEqual(client[kPending], 2)

    await waitFor(() => client[kRunning] === 2 && responses.length === 2)
    p.equal(client[kRunning], 2)

    for (const res of responses) {
      res.end()
    }

    await Promise.all([firstEnd, secondEnd, p.completed])
  } finally {
    await client.close()
    await new Promise(resolve => server.close(resolve))
  }
})

test('pipeline pipelining retry', async (t) => {
  const p = tspl(t, { plan: 13 })

  let count = 0
  let firstResponse = null
  const server = createServer({ joinDuplicateHeaders: true }, (req, res) => {
    if (count++ === 0) {
      firstResponse = res
    } else {
      res.end()
    }
  })

  server.listen(0)
  await once(server, 'listening')

  const client = new Client(`http://localhost:${server.address().port}`, {
    pipelining: 3
  })

  try {
    client.once('disconnect', () => {
      p.ok(true, 'pass')
    })

    await new Promise(resolve => client[kConnect](resolve))

    const first = client.pipeline({
      method: 'GET',
      path: '/',
      blocking: false
    }, ({ body }) => body)
    const firstError = once(first, 'error').then(([err]) => {
      p.ok(err)
    })
    first.end().resume()
    p.equal(client[kBusy], true)
    p.deepStrictEqual(client[kRunning], 0)
    p.deepStrictEqual(client[kPending], 1)

    const second = client.pipeline({
      method: 'GET',
      path: '/',
      blocking: false
    }, ({ body }) => body)
    const secondEnd = once(second, 'end')
    second.end().resume()
    p.equal(client[kBusy], true)
    p.deepStrictEqual(client[kRunning], 0)
    p.deepStrictEqual(client[kPending], 2)

    const third = client.pipeline({
      method: 'GET',
      path: '/',
      blocking: false
    }, ({ body }) => body)
    const thirdEnd = once(third, 'end')
    third.end().resume()
    p.equal(client[kBusy], true)
    p.deepStrictEqual(client[kRunning], 0)
    p.deepStrictEqual(client[kPending], 3)

    await waitFor(() => client[kRunning] === 3 && firstResponse)
    p.equal(client[kRunning], 3)

    firstResponse.destroy()

    await Promise.all([firstError, secondEnd, thirdEnd])
    await new Promise(resolve => {
      client.close(() => {
        p.ok(true, 'pass')
        resolve()
      })
    })

    await p.completed
  } finally {
    client.destroy()
    await new Promise(resolve => server.close(resolve))
  }
})
