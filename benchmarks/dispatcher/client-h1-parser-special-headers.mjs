import { bench, group, run } from 'mitata'
import { bufferToLowerCasedHeaderName } from '../../lib/core/util.js'

function bufferEqualsContentLength (buf) {
  return buf.length === 14 &&
    (buf[0] | 32) === 99 &&
    (buf[1] | 32) === 111 &&
    (buf[2] | 32) === 110 &&
    (buf[3] | 32) === 116 &&
    (buf[4] | 32) === 101 &&
    (buf[5] | 32) === 110 &&
    (buf[6] | 32) === 116 &&
    buf[7] === 45 &&
    (buf[8] | 32) === 108 &&
    (buf[9] | 32) === 101 &&
    (buf[10] | 32) === 110 &&
    (buf[11] | 32) === 103 &&
    (buf[12] | 32) === 116 &&
    (buf[13] | 32) === 104
}

function bufferEqualsConnection (buf) {
  return buf.length === 10 &&
    (buf[0] | 32) === 99 &&
    (buf[1] | 32) === 111 &&
    (buf[2] | 32) === 110 &&
    (buf[3] | 32) === 110 &&
    (buf[4] | 32) === 101 &&
    (buf[5] | 32) === 99 &&
    (buf[6] | 32) === 116 &&
    (buf[7] | 32) === 105 &&
    (buf[8] | 32) === 111 &&
    (buf[9] | 32) === 110
}

function bufferEqualsKeepAlive (buf) {
  return buf.length === 10 &&
    (buf[0] | 32) === 107 &&
    (buf[1] | 32) === 101 &&
    (buf[2] | 32) === 101 &&
    (buf[3] | 32) === 112 &&
    buf[4] === 45 &&
    (buf[5] | 32) === 97 &&
    (buf[6] | 32) === 108 &&
    (buf[7] | 32) === 105 &&
    (buf[8] | 32) === 118 &&
    (buf[9] | 32) === 101
}

function oldOnHeaderValue (parser, buf) {
  let len = parser.headers.length

  if ((len & 1) === 1) {
    parser.headers.push(buf)
    len += 1
  } else {
    parser.headers[len - 1] = Buffer.concat([parser.headers[len - 1], buf])
  }

  const key = parser.headers[len - 2]
  if (key.length === 10) {
    const headerName = bufferToLowerCasedHeaderName(key)
    if (headerName === 'keep-alive') {
      parser.keepAlive += buf.toString()
    } else if (headerName === 'connection') {
      parser.connectionKeepAlive =
        parser.headers[len - 1].length === 10 &&
        bufferToLowerCasedHeaderName(parser.headers[len - 1]) === 'keep-alive'
    }
  } else if (key.length === 14 && bufferToLowerCasedHeaderName(key) === 'content-length') {
    parser.contentLength += buf.toString()
  }
}

function newOnHeaderValue (parser, buf) {
  let len = parser.headers.length

  if ((len & 1) === 1) {
    parser.headers.push(buf)
    len += 1
  } else {
    parser.headers[len - 1] = Buffer.concat([parser.headers[len - 1], buf])
  }

  const key = parser.headers[len - 2]
  if (bufferEqualsKeepAlive(key)) {
    parser.keepAlive += buf.toString()
  } else if (bufferEqualsConnection(key)) {
    parser.connectionKeepAlive = bufferEqualsKeepAlive(parser.headers[len - 1])
  } else if (bufferEqualsContentLength(key)) {
    parser.contentLength += buf.toString()
  }
}

const completeHeaders = [
  [Buffer.from('Content-Length'), Buffer.from('12345')],
  [Buffer.from('Connection'), Buffer.from('keep-alive')],
  [Buffer.from('Keep-Alive'), Buffer.from('timeout=5')],
  [Buffer.from('X-Request-ID'), Buffer.from('abc123')]
]

const fragmentedHeaders = [
  [Buffer.from('Content-Length'), [Buffer.from('12'), Buffer.from('345')]],
  [Buffer.from('Connection'), [Buffer.from('keep-'), Buffer.from('alive')]],
  [Buffer.from('Keep-Alive'), [Buffer.from('timeout='), Buffer.from('5')]],
  [Buffer.from('X-Request-ID'), [Buffer.from('abc'), Buffer.from('123')]]
]

function resetParser (parser, key) {
  parser.headers.length = 0
  parser.headers.push(key)
  parser.keepAlive = ''
  parser.connectionKeepAlive = false
  parser.contentLength = ''
}

function createParsers () {
  return Array.from({ length: completeHeaders.length }, () => ({
    headers: [],
    keepAlive: '',
    connectionKeepAlive: false,
    contentLength: ''
  }))
}

group('client-h1 parser special headers', () => {
  const oldParsers = createParsers()
  const newParsers = createParsers()

  bench('old lowercased header name', () => {
    for (let i = 0; i < completeHeaders.length; ++i) {
      const [key, value] = completeHeaders[i]
      const parser = oldParsers[i]

      resetParser(parser, key)
      oldOnHeaderValue(parser, value)
    }
  })

  bench('new buffer equality', () => {
    for (let i = 0; i < completeHeaders.length; ++i) {
      const [key, value] = completeHeaders[i]
      const parser = newParsers[i]

      resetParser(parser, key)
      newOnHeaderValue(parser, value)
    }
  })
})

group('client-h1 parser fragmented special headers', () => {
  const oldParsers = createParsers()
  const newParsers = createParsers()

  bench('old lowercased header name', () => {
    for (let i = 0; i < fragmentedHeaders.length; ++i) {
      const [key, values] = fragmentedHeaders[i]
      const parser = oldParsers[i]

      resetParser(parser, key)
      for (let j = 0; j < values.length; ++j) {
        oldOnHeaderValue(parser, values[j])
      }
    }
  })

  bench('new buffer equality', () => {
    for (let i = 0; i < fragmentedHeaders.length; ++i) {
      const [key, values] = fragmentedHeaders[i]
      const parser = newParsers[i]

      resetParser(parser, key)
      for (let j = 0; j < values.length; ++j) {
        newOnHeaderValue(parser, values[j])
      }
    }
  })
})

await run()
