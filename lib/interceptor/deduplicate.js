'use strict'

const diagnosticsChannel = require('node:diagnostics_channel')
const util = require('../core/util')
const DeduplicationHandler = require('../handler/deduplication-handler')
const {
  normalizeHeaders,
  makeCacheKey,
  makeDeduplicationKey,
  makeDeduplicationLookupKey
} = require('../util/cache.js')

const pendingRequestsChannel = diagnosticsChannel.channel('undici:request:pending-requests')

function hasMatchingHeaderName (headers, headerNames) {
  if (headers == null) {
    return false
  }

  if (typeof headers !== 'object') {
    throw new Error('opts.headers is not an object')
  }

  if (util.hasSafeIterator(headers)) {
    for (const header of headers) {
      if (!Array.isArray(header)) {
        throw new Error('opts.headers is not a valid header map')
      }

      const [key, val] = header
      if (typeof key !== 'string' || typeof val !== 'string') {
        throw new Error('opts.headers is not a valid header map')
      }

      if (headerNames.has(key.toLowerCase())) {
        return true
      }
    }

    return false
  }

  for (const key of Object.keys(headers)) {
    if (headerNames.has(key.toLowerCase())) {
      return true
    }
  }

  return false
}

/**
 * @param {import('../../types/interceptors.d.ts').default.DeduplicateInterceptorOpts} [opts]
 * @returns {import('../../types/dispatcher.d.ts').default.DispatcherComposeInterceptor}
 */
module.exports = (opts = {}) => {
  const {
    methods = ['GET'],
    skipHeaderNames = [],
    excludeHeaderNames = [],
    maxBufferSize = 5 * 1024 * 1024
  } = opts

  if (typeof opts !== 'object' || opts === null) {
    throw new TypeError(`expected type of opts to be an Object, got ${opts === null ? 'null' : typeof opts}`)
  }

  if (!Array.isArray(methods)) {
    throw new TypeError(`expected opts.methods to be an array, got ${typeof methods}`)
  }

  for (const method of methods) {
    if (!util.safeHTTPMethods.includes(method)) {
      throw new TypeError(`expected opts.methods to only contain safe HTTP methods, got ${method}`)
    }
  }

  if (!Array.isArray(skipHeaderNames)) {
    throw new TypeError(`expected opts.skipHeaderNames to be an array, got ${typeof skipHeaderNames}`)
  }

  if (!Array.isArray(excludeHeaderNames)) {
    throw new TypeError(`expected opts.excludeHeaderNames to be an array, got ${typeof excludeHeaderNames}`)
  }

  if (!Number.isFinite(maxBufferSize) || maxBufferSize <= 0) {
    throw new TypeError(`expected opts.maxBufferSize to be a positive finite number, got ${maxBufferSize}`)
  }

  // Convert to lowercase Set for case-insensitive header matching
  const skipHeaderNamesSet = new Set(skipHeaderNames.map(name => name.toLowerCase()))

  // Convert to lowercase Set for case-insensitive header exclusion from deduplication key
  const excludeHeaderNamesSet = new Set(excludeHeaderNames.map(name => name.toLowerCase()))

  /**
   * Map of pending requests keyed by origin/method/path, with one entry per
   * distinct header-based deduplication key for that resource.
   * @type {Map<string, Array<{
   *   dedupeKey?: string,
   *   handler: DeduplicationHandler,
   *   opts: import('../../types/dispatcher.d.ts').default.DispatchOptions
   * }>>}
   */
  const pendingRequests = new Map()
  let pendingRequestCount = 0

  function makePendingRequestKey (requestOpts) {
    return makeDeduplicationKey(
      makeCacheKey(requestOpts, normalizeHeaders(requestOpts)),
      excludeHeaderNamesSet
    )
  }

  function getEntryDedupeKey (entry) {
    if (entry.dedupeKey === undefined) {
      entry.dedupeKey = makePendingRequestKey(entry.opts)
    }

    return entry.dedupeKey
  }

  function removeEntry (lookupKey, entry) {
    const pendingEntries = pendingRequests.get(lookupKey)
    if (pendingEntries === undefined) {
      return
    }

    const index = pendingEntries.indexOf(entry)
    if (index === -1) {
      return
    }

    pendingEntries.splice(index, 1)
    pendingRequestCount--

    if (pendingEntries.length === 0) {
      pendingRequests.delete(lookupKey)
    }

    if (pendingRequestsChannel.hasSubscribers) {
      pendingRequestsChannel.publish({ size: pendingRequestCount, key: getEntryDedupeKey(entry), type: 'removed' })
    }
  }

  return dispatch => {
    return (opts, handler) => {
      if (!opts.origin || methods.includes(opts.method) === false) {
        return dispatch(opts, handler)
      }

      // Skip deduplication if request contains any of the specified headers
      if (skipHeaderNamesSet.size > 0 && hasMatchingHeaderName(opts.headers, skipHeaderNamesSet)) {
        return dispatch(opts, handler)
      }

      const lookupKey = makeDeduplicationLookupKey(opts)
      const pendingEntries = pendingRequests.get(lookupKey)

      if (pendingEntries !== undefined) {
        const dedupeKey = makePendingRequestKey(opts)

        for (const pendingEntry of pendingEntries) {
          if (getEntryDedupeKey(pendingEntry) !== dedupeKey) {
            continue
          }

          // Add this handler to the waiting list when safe.
          // If body streaming has already started, this request must be sent independently.
          if (pendingEntry.handler.addWaitingHandler(handler)) {
            return true
          }

          return dispatch(opts, handler)
        }
      }

      /** @type {{ dedupeKey?: string, handler: DeduplicationHandler, opts: import('../../types/dispatcher.d.ts').default.DispatchOptions }} */
      const pendingEntry = {
        opts,
        handler: null
      }

      // Create a new deduplication handler
      const deduplicationHandler = new DeduplicationHandler(
        handler,
        () => removeEntry(lookupKey, pendingEntry),
        maxBufferSize
      )
      pendingEntry.handler = deduplicationHandler

      // Register the pending request
      if (pendingEntries === undefined) {
        pendingRequests.set(lookupKey, [pendingEntry])
      } else {
        pendingEntries.push(pendingEntry)
      }
      pendingRequestCount++

      if (pendingRequestsChannel.hasSubscribers) {
        pendingRequestsChannel.publish({ size: pendingRequestCount, key: getEntryDedupeKey(pendingEntry), type: 'added' })
      }

      return dispatch(opts, deduplicationHandler)
    }
  }
}
