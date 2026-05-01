import { bench, group, run } from 'mitata'

function oldBuildH2RequestHeaders (reqHeaders) {
  const headers = {}

  for (let n = 0; n < reqHeaders.length; n += 2) {
    const key = reqHeaders[n + 0]
    const val = reqHeaders[n + 1]

    if (key === 'cookie') {
      if (headers[key] != null) {
        headers[key] = Array.isArray(headers[key]) ? (headers[key].push(val), headers[key]) : [headers[key], val]
      } else {
        headers[key] = val
      }

      continue
    }

    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        if (headers[key]) {
          headers[key] += `, ${val[i]}`
        } else {
          headers[key] = val[i]
        }
      }
    } else if (headers[key]) {
      headers[key] += `, ${val}`
    } else {
      headers[key] = val
    }
  }

  return headers
}

function processH2RequestHeader (headers, key, val) {
  if (key === 'cookie') {
    if (headers[key] != null) {
      headers[key] = Array.isArray(headers[key]) ? (headers[key].push(val), headers[key]) : [headers[key], val]
    } else {
      headers[key] = val
    }

    return
  }

  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      if (headers[key]) {
        headers[key] += `, ${val[i]}`
      } else {
        headers[key] = val[i]
      }
    }
  } else if (headers[key]) {
    headers[key] += `, ${val}`
  } else {
    headers[key] = val
  }
}

function buildH2RequestHeaders (reqHeaders) {
  const headers = {}

  for (let n = 0; n < reqHeaders.length; n += 2) {
    const key = reqHeaders[n + 0]
    const val = reqHeaders[n + 1]

    if (key === 'cookie' || Array.isArray(val) || headers[key] !== undefined) {
      processH2RequestHeader(headers, key, val)

      for (n += 2; n < reqHeaders.length; n += 2) {
        processH2RequestHeader(headers, reqHeaders[n + 0], reqHeaders[n + 1])
      }

      return headers
    }

    headers[key] = val
  }

  return headers
}

const cases = {
  simple4: [
    'accept', '*/*',
    'user-agent', 'undici',
    'x-a', '1',
    'x-b', '2'
  ],
  simple12: Array.from({ length: 12 }, (_, i) => [`x-${i}`, `${i}`]).flat(),
  duplicate: [
    'x-a', '1',
    'x-b', '2',
    'x-a', '3',
    'x-c', '4'
  ],
  arrayValue: [
    'x-a', '1',
    'x-b', ['2', '3'],
    'x-c', '4'
  ],
  cookies: [
    'x-a', '1',
    'cookie', 'a=b',
    'x-b', '2',
    'cookie', 'c=d'
  ]
}

for (const [name, headers] of Object.entries(cases)) {
  group(name, () => {
    bench('old', () => oldBuildH2RequestHeaders(headers))
    bench('fast-path', () => buildH2RequestHeaders(headers))
  })
}

await run()
