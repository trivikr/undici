import { bench, group, run } from 'mitata'

function createObject (size, nullPrototype = false) {
  const object = nullPrototype ? Object.create(null) : {}

  for (let i = 0; i < size; ++i) {
    object[`x-header-${i}`] = `value-${i}`
  }

  return object
}

function createObjectWithProxyAuthorization (size, atStart) {
  const object = {}

  if (atStart) {
    object['proxy-authorization'] = 'value-proxy'
  }

  for (let i = 0; i < size; ++i) {
    object[`x-header-${i}`] = `value-${i}`
  }

  if (!atStart) {
    object['proxy-authorization'] = 'value-proxy'
  }

  return object
}

function scanWithObjectKeys (object) {
  let total = 0
  const keys = Object.keys(object)

  for (let i = 0; i < keys.length; ++i) {
    total += object[keys[i]].length
  }

  return total
}

function scanWithForIn (object) {
  let total = 0

  for (const key in object) {
    if (Object.hasOwn(object, key)) {
      total += object[key].length
    }
  }

  return total
}

function scanWithObjectEntries (object) {
  let total = 0

  for (const [key, value] of Object.entries(object)) {
    total += key.length + value.length
  }

  return total
}

function scanWithForInPairs (object) {
  let total = 0

  for (const key in object) {
    if (Object.hasOwn(object, key)) {
      total += key.length + object[key].length
    }
  }

  return total
}

function hasKeyWithObjectKeys (object) {
  return Object.keys(object).length !== 0
}

function hasKeyWithForIn (object) {
  for (const key in object) {
    if (Object.hasOwn(object, key)) {
      return true
    }
  }

  return false
}

function hasProxyAuthorizationWithObjectKeys (object) {
  return Object.keys(object).find((key) => key.toLowerCase() === 'proxy-authorization') !== undefined
}

function hasProxyAuthorizationWithForIn (object) {
  for (const key in object) {
    if (Object.hasOwn(object, key) && key.toLowerCase() === 'proxy-authorization') {
      return true
    }
  }

  return false
}

const plainSmall = createObject(8)
const plainMedium = createObject(32)
const recordSmall = createObject(8, true)
const recordMedium = createObject(32, true)
const emptyInit = {}
const nonEmptyInit = createObject(32)
const proxyAuthorizationFirst = createObjectWithProxyAuthorization(31, true)
const proxyAuthorizationLast = createObjectWithProxyAuthorization(31, false)

for (const [name, object] of [
  ['plain object (8 keys)', plainSmall],
  ['plain object (32 keys)', plainMedium],
  ['null-prototype record (8 keys)', recordSmall],
  ['null-prototype record (32 keys)', recordMedium]
]) {
  group(`full scan: ${name}`, () => {
    bench('Object.keys + index access', () => {
      return scanWithObjectKeys(object)
    })

    bench('for...in + Object.hasOwn', () => {
      return scanWithForIn(object)
    })

    bench('Object.entries', () => {
      return scanWithObjectEntries(object)
    })

    bench('for...in + Object.hasOwn (pairs)', () => {
      return scanWithForInPairs(object)
    })
  })
}

group('emptiness check: empty init', () => {
  bench('Object.keys(init).length !== 0', () => {
    return hasKeyWithObjectKeys(emptyInit)
  })

  bench('for...in + Object.hasOwn early exit', () => {
    return hasKeyWithForIn(emptyInit)
  })
})

group('emptiness check: non-empty init', () => {
  bench('Object.keys(init).length !== 0', () => {
    return hasKeyWithObjectKeys(nonEmptyInit)
  })

  bench('for...in + Object.hasOwn early exit', () => {
    return hasKeyWithForIn(nonEmptyInit)
  })
})

group('early exit scan: proxy-authorization first', () => {
  bench('Object.keys(...).find(...)', () => {
    return hasProxyAuthorizationWithObjectKeys(proxyAuthorizationFirst)
  })

  bench('for...in + Object.hasOwn early exit', () => {
    return hasProxyAuthorizationWithForIn(proxyAuthorizationFirst)
  })
})

group('full scan: proxy-authorization last', () => {
  bench('Object.keys(...).find(...)', () => {
    return hasProxyAuthorizationWithObjectKeys(proxyAuthorizationLast)
  })

  bench('for...in + Object.hasOwn', () => {
    return hasProxyAuthorizationWithForIn(proxyAuthorizationLast)
  })
})

await run()
