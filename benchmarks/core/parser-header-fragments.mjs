import assert from 'node:assert'
import net from 'node:net'
import process from 'node:process'
import { once } from 'node:events'

import { bench, group, run } from 'mitata'

import undici from '../../index.js'
import symbols from '../../lib/core/symbols.js'

const { Client } = undici
const { kSocket, kParser } = symbols

const headerValueBytes = parseInt(process.env.HEADER_VALUE_BYTES ?? '4096', 10)
const fragmentBytes = parseInt(process.env.FRAGMENT_BYTES ?? '16', 10)
const minSamples = parseInt(process.env.MIN_SAMPLES ?? '100', 10)
const maxSamples = parseInt(process.env.MAX_SAMPLES ?? '200', 10)

function splitBuffer (buffer, size) {
  const chunks = []

  for (let i = 0; i < buffer.length; i += size) {
    chunks.push(buffer.subarray(i, i + size))
  }

  return chunks
}

function resetParserState (parser) {
  parser.headers = []
  parser.headersSize = 0
  parser.keepAlive = ''
  parser.contentLength = ''
  parser.connection = ''
}

function finalizeHeadersCompat (parser) {
  if (typeof parser.finalizeHeaders === 'function') {
    parser.finalizeHeaders()
  }
}

function createScenario (fragmented) {
  const longValue = Buffer.alloc(headerValueBytes, 'a')
  const headers = [
    [Buffer.from('connection'), Buffer.from('keep-alive')],
    [Buffer.from('keep-alive'), Buffer.from('timeout=1')],
    [Buffer.from('content-length'), Buffer.from('5')],
    [Buffer.from('x-benchmark-header'), longValue]
  ]

  return headers.map(([field, value]) => ({
    field: fragmented ? splitBuffer(field, fragmentBytes) : [field],
    value: fragmented ? splitBuffer(value, fragmentBytes) : [value]
  }))
}

function runScenario (parser, scenario) {
  resetParserState(parser)

  for (const entry of scenario) {
    for (const chunk of entry.field) {
      parser.onHeaderField(chunk)
    }

    for (const chunk of entry.value) {
      parser.onHeaderValue(chunk)
    }
  }

  finalizeHeadersCompat(parser)
}

function validateScenario (parser, scenario) {
  runScenario(parser, scenario)

  assert.strictEqual(parser.headers[0].toString(), 'connection')
  assert.strictEqual(parser.headers[1].toString(), 'keep-alive')
  assert.strictEqual(parser.headers[2].toString(), 'keep-alive')
  assert.strictEqual(parser.headers[3].toString(), 'timeout=1')
  assert.strictEqual(parser.headers[4].toString(), 'content-length')
  assert.strictEqual(parser.headers[5].toString(), '5')
  assert.strictEqual(parser.headers[6].toString(), 'x-benchmark-header')
  assert.strictEqual(parser.headers[7].length, headerValueBytes)
  assert.strictEqual(parser.connection, 'keep-alive')
  assert.strictEqual(parser.keepAlive, 'timeout=1')
  assert.strictEqual(parser.contentLength, '5')

  resetParserState(parser)
}

async function createParser () {
  const server = net.createServer((socket) => {
    socket.once('data', () => {
      socket.write('HTTP/1.1 200 OK\r\ncontent-length: 0\r\nconnection: keep-alive\r\n\r\n')
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  const address = server.address()
  const client = new Client(`http://127.0.0.1:${address.port}`)

  const { body } = await client.request({
    path: '/',
    method: 'GET'
  })
  await body.text()

  const parser = client[kSocket][kParser]

  return {
    client,
    parser,
    async close () {
      await client.close()
      server.close()
      await once(server, 'close')
    }
  }
}

const parserContext = await createParser()

try {
  const contiguous = createScenario(false)
  const fragmented = createScenario(true)

  validateScenario(parserContext.parser, contiguous)
  validateScenario(parserContext.parser, fragmented)

  console.log('parser-header-fragments')
  console.log(`headerValueBytes=${headerValueBytes} fragmentBytes=${fragmentBytes} minSamples=${minSamples} maxSamples=${maxSamples}`)

  group('client-h1 parser callbacks', () => {
    bench('contiguous headers', () => {
      runScenario(parserContext.parser, contiguous)
    })

    bench('fragmented headers', () => {
      runScenario(parserContext.parser, fragmented)
    })
  })

  await run({
    min_samples: minSamples,
    max_samples: maxSamples
  })
} finally {
  await parserContext.close()
}
