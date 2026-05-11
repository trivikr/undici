import { bench, do_not_optimize as doNotOptimize, group, run } from 'mitata'

const EMPTY_BUF = Buffer.alloc(0)
const STATUS_TEXT = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout'
}
const STATUS_TEXT_BUF = Object.create(null)

for (const statusCode of Object.keys(STATUS_TEXT)) {
  STATUS_TEXT_BUF[statusCode] = Buffer.from(STATUS_TEXT[statusCode])
}

const common = [
  { statusCode: 200, chunks: [Buffer.from('OK')] },
  { statusCode: 204, chunks: [Buffer.from('No Content')] },
  { statusCode: 304, chunks: [Buffer.from('Not Modified')] },
  { statusCode: 404, chunks: [Buffer.from('Not Found')] },
  { statusCode: 500, chunks: [Buffer.from('Internal Server Error')] }
]
const custom = [
  { statusCode: 200, chunks: [Buffer.from('Custom Status Text')] },
  { statusCode: 418, chunks: [Buffer.from('I am a Teapot')] },
  { statusCode: 599, chunks: [Buffer.from('Network Connect Timeout Error')] }
]
const split = [
  { statusCode: 200, chunks: [Buffer.from('O'), Buffer.from('K')] },
  { statusCode: 204, chunks: [Buffer.from('No '), Buffer.from('Content')] },
  { statusCode: 404, chunks: [Buffer.from('Not'), Buffer.from(' Found')] }
]
const mixed = [
  ...common,
  ...common,
  ...common,
  ...common,
  ...custom,
  ...split
]

function eagerStatusText (chunks) {
  let statusText = ''

  for (let i = 0; i < chunks.length; i++) {
    statusText = chunks[i].toString()
  }

  return statusText
}

function captureStatusText (chunks) {
  let statusText = EMPTY_BUF

  for (let i = 0; i < chunks.length; i++) {
    const buf = chunks[i]

    if (statusText === EMPTY_BUF) {
      statusText = buf
    } else if (Array.isArray(statusText)) {
      statusText.push(buf)
    } else {
      statusText = [statusText, buf]
    }
  }

  return statusText
}

function isStatusText (buf, statusCode) {
  const expected = STATUS_TEXT_BUF[statusCode]

  if (expected == null) {
    return false
  }

  if (Array.isArray(buf)) {
    let offset = 0

    for (const chunk of buf) {
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] !== expected[offset++]) {
          return false
        }
      }
    }

    return offset === expected.length
  }

  return buf.equals(expected)
}

function deferredStatusText (statusCode, chunks) {
  const statusText = captureStatusText(chunks)

  if (statusText === EMPTY_BUF) {
    return ''
  }

  if (isStatusText(statusText, statusCode)) {
    return STATUS_TEXT[statusCode]
  }

  return Array.isArray(statusText)
    ? Buffer.concat(statusText).toString()
    : statusText.toString()
}

function runCases (cases, fn) {
  for (let i = 0; i < cases.length; i++) {
    const { statusCode, chunks } = cases[i]
    doNotOptimize(fn(statusCode, chunks))
  }
}

group('status text common reason phrases', () => {
  bench('eager decode', () => {
    runCases(common, (_statusCode, chunks) => eagerStatusText(chunks))
  })

  bench('deferred map', () => {
    runCases(common, deferredStatusText)
  })
})

group('status text custom reason phrases', () => {
  bench('eager decode', () => {
    runCases(custom, (_statusCode, chunks) => eagerStatusText(chunks))
  })

  bench('deferred fallback decode', () => {
    runCases(custom, deferredStatusText)
  })
})

group('status text split reason phrases', () => {
  bench('eager decode', () => {
    runCases(split, (_statusCode, chunks) => eagerStatusText(chunks))
  })

  bench('deferred map', () => {
    runCases(split, deferredStatusText)
  })
})

group('status text mixed responses', () => {
  bench('eager decode', () => {
    runCases(mixed, (_statusCode, chunks) => eagerStatusText(chunks))
  })

  bench('deferred map/fallback', () => {
    runCases(mixed, deferredStatusText)
  })
})

await run()
