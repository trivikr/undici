'use strict'
const EventEmitter = require('node:events')
const { InvalidArgumentError } = require('../core/errors')
const {
  hasSafeIterator,
  isValidHeaderValue,
  isValidHTTPToken
} = require('../core/util')

function isLowerCaseHeaderName (value) {
  if (!isValidHTTPToken(value)) {
    return false
  }

  for (let i = 0; i < value.length; ++i) {
    const code = value.charCodeAt(i)
    if (code >= 65 && code <= 90) {
      return false
    }
  }

  return true
}

function appendHeader (headers, key, val) {
  if (val === undefined) {
    return
  }

  if (typeof key !== 'string') {
    throw new InvalidArgumentError('invalid header key')
  }

  const headerName = key.toLowerCase()

  if (!isValidHTTPToken(headerName)) {
    throw new InvalidArgumentError('invalid header key')
  }

  if (Array.isArray(val)) {
    for (const item of val) {
      appendHeader(headers, headerName, item)
    }
    return
  }

  if (val && typeof val === 'object') {
    throw new InvalidArgumentError(`invalid ${key} header`)
  }

  if (val === null) {
    val = ''
  } else if (typeof val !== 'string') {
    val = `${val}`
  }

  if (!isValidHeaderValue(val)) {
    throw new InvalidArgumentError(`invalid ${key} header`)
  }

  if (!Object.hasOwn(headers, headerName)) {
    if (headerName === '__proto__') {
      Object.defineProperty(headers, headerName, {
        value: val,
        enumerable: true,
        configurable: true,
        writable: true
      })
    } else {
      headers[headerName] = val
    }
  } else {
    headers[headerName] += `${headerName === 'cookie' ? ';' : ','} ${val}`
  }
}

function isNormalizedHeaders (headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || hasSafeIterator(headers)) {
    return false
  }

  const keys = Object.keys(headers)

  for (let i = 0; i < keys.length; ++i) {
    const key = keys[i]
    const val = headers[key]

    if (!isLowerCaseHeaderName(key) || typeof val !== 'string' || !isValidHeaderValue(val)) {
      return false
    }
  }

  return true
}

function normalizeHeaders (headers) {
  const normalized = {}

  if (headers == null) {
    return normalized
  }

  if (Array.isArray(headers)) {
    if (headers.length % 2 !== 0) {
      throw new InvalidArgumentError('headers array must be even')
    }

    for (let i = 0; i < headers.length; i += 2) {
      appendHeader(normalized, headers[i], headers[i + 1])
    }
  } else if (headers && typeof headers === 'object') {
    if (hasSafeIterator(headers)) {
      for (const header of headers) {
        if (!Array.isArray(header) || header.length !== 2) {
          throw new InvalidArgumentError('headers must be in key-value pair format')
        }
        appendHeader(normalized, header[0], header[1])
      }
    } else {
      const keys = Object.keys(headers)
      for (let i = 0; i < keys.length; ++i) {
        appendHeader(normalized, keys[i], headers[keys[i]])
      }
    }
  } else {
    throw new InvalidArgumentError('headers must be an object or an array')
  }

  return normalized
}

function appendQueryParam (query, key, val) {
  if (val === undefined) {
    return
  }

  if (Array.isArray(val)) {
    for (const item of val) {
      appendQueryParam(query, key, item)
    }
    return
  }

  const value = val === null ? '' : `${val}`

  if (!Object.hasOwn(query, key)) {
    if (key === '__proto__') {
      Object.defineProperty(query, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      })
    } else {
      query[key] = value
    }
  } else if (Array.isArray(query[key])) {
    query[key].push(value)
  } else {
    query[key] = [query[key], value]
  }
}

function isNormalizedQuery (query) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || hasSafeIterator(query)) {
    return false
  }

  const keys = Object.keys(query)

  for (let i = 0; i < keys.length; ++i) {
    const val = query[keys[i]]

    if (Array.isArray(val)) {
      for (let j = 0; j < val.length; ++j) {
        if (typeof val[j] !== 'string') {
          return false
        }
      }
    } else if (typeof val !== 'string') {
      return false
    }
  }

  return true
}

function normalizeQuery (query) {
  const normalized = {}

  if (query == null) {
    return normalized
  }

  if (typeof query === 'string' || query instanceof URLSearchParams) {
    query = new URLSearchParams(query)
  }

  if (query && typeof query === 'object') {
    if (hasSafeIterator(query)) {
      for (const param of query) {
        if (!Array.isArray(param) || param.length !== 2) {
          throw new InvalidArgumentError('query must be in key-value pair format')
        }
        appendQueryParam(normalized, param[0], param[1])
      }
    } else {
      const keys = Object.keys(query)
      for (let i = 0; i < keys.length; ++i) {
        appendQueryParam(normalized, keys[i], query[keys[i]])
      }
    }
  } else {
    throw new InvalidArgumentError('query must be an object')
  }

  return normalized
}

function normalizeInterceptorOpts (opts) {
  if (!opts || typeof opts !== 'object') {
    return opts
  }

  let normalized = null
  let headers = opts.headers

  if (headers == null) {
    headers = {}
  } else if (!isNormalizedHeaders(headers)) {
    headers = normalizeHeaders(headers)
  }

  if (headers !== opts.headers) {
    normalized = {
      ...opts,
      headers
    }
  }

  if (opts.query != null) {
    const query = isNormalizedQuery(opts.query) ? opts.query : normalizeQuery(opts.query)

    if (query !== opts.query) {
      normalized ??= { ...opts, headers }
      normalized.query = query
    }
  }

  if (opts.searchParams != null) {
    const searchParams = isNormalizedQuery(opts.searchParams) ? opts.searchParams : normalizeQuery(opts.searchParams)

    if (searchParams !== opts.searchParams) {
      normalized ??= { ...opts, headers }
      normalized.searchParams = searchParams
    }
  }

  return normalized ?? opts
}

class Dispatcher extends EventEmitter {
  dispatch () {
    throw new Error('not implemented')
  }

  close () {
    throw new Error('not implemented')
  }

  destroy () {
    throw new Error('not implemented')
  }

  compose (...args) {
    // So we handle [interceptor1, interceptor2] or interceptor1, interceptor2, ...
    const interceptors = Array.isArray(args[0]) ? args[0] : args
    let dispatch = this.dispatch.bind(this)

    for (const interceptor of interceptors) {
      if (interceptor == null) {
        continue
      }

      if (typeof interceptor !== 'function') {
        throw new TypeError(`invalid interceptor, expected function received ${typeof interceptor}`)
      }

      dispatch = interceptor(dispatch)

      if (dispatch == null || typeof dispatch !== 'function' || dispatch.length !== 2) {
        throw new TypeError('invalid interceptor')
      }
    }

    return new Proxy(this, {
      get: (target, key) => key === 'dispatch'
        ? (opts, handler) => dispatch(normalizeInterceptorOpts(opts), handler)
        : target[key]
    })
  }
}

module.exports = Dispatcher
