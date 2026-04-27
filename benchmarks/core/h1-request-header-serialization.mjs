import { bench, group, run } from 'mitata'

const client = {
  hostHeader: 'host: localhost:3000\r\n',
  pipelining: 1
}

const socket = {
  reset: false
}

const headers = {
  none: [],
  one: ['accept', '*/*'],
  two: ['accept', '*/*', 'user-agent', 'undici'],
  four: [
    'accept', '*/*',
    'user-agent', 'undici',
    'accept-language', '*',
    'cache-control', 'no-cache'
  ],
  multi: ['accept', ['text/plain', 'application/json']]
}

let sink = ''
let index = 0
const paths = ['/', '/a', '/abc', '/abcdef']

function buildGenericHeader (client, socket, method, path, host, upgrade, headers) {
  let header = `${method} ${path} HTTP/1.1\r\n`

  if (typeof host === 'string') {
    header += `host: ${host}\r\n`
  } else {
    header += client.hostHeader
  }

  if (upgrade) {
    header += `connection: upgrade\r\nupgrade: ${upgrade}\r\n`
  } else if (client.pipelining && !socket.reset) {
    header += 'connection: keep-alive\r\n'
  } else {
    header += 'connection: close\r\n'
  }

  for (let n = 0; n < headers.length; n += 2) {
    const key = headers[n + 0]
    const val = headers[n + 1]

    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        header += `${key}: ${val[i]}\r\n`
      }
    } else {
      header += `${key}: ${val}\r\n`
    }
  }

  return header
}

function buildFastHeader (client, socket, method, path, host, upgrade, headers, isNoBody) {
  if (method === 'GET' && upgrade == null && isNoBody && headers.length === 0) {
    const hostHeader = typeof host === 'string'
      ? `host: ${host}\r\n`
      : client.hostHeader

    return client.pipelining && !socket.reset
      ? `GET ${path} HTTP/1.1\r\n${hostHeader}connection: keep-alive\r\n`
      : `GET ${path} HTTP/1.1\r\n${hostHeader}connection: close\r\n`
  }

  return buildGenericHeader(client, socket, method, path, host, upgrade, headers)
}

for (const [name, headerList] of Object.entries(headers)) {
  group(name, () => {
    bench('generic', () => {
      sink = buildGenericHeader(client, socket, 'GET', paths[index++ & 3], null, null, headerList)
    })

    bench('fast', () => {
      sink = buildFastHeader(client, socket, 'GET', paths[index++ & 3], null, null, headerList, true)
    })
  })
}

await run()

if (sink.length === 0) {
  throw new Error('unreachable')
}
