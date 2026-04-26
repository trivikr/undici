'use strict'
/* global jest, describe, it, beforeEach, afterEach, expect */

const EventEmitter = require('node:events')
const connectH1 = require('../../lib/dispatcher/client-h1')
const {
  kMaxHeadersSize,
  kMaxResponseSize,
  kParser,
  kQueue,
  kRunningIdx
} = require('../../lib/core/symbols')

class DummySocket extends EventEmitter {
  constructor () {
    super()
    this.destroyed = false
    this.errored = null
  }

  read () {
    return null
  }
}

const dummyClient = {
  [kMaxHeadersSize]: 1024,
  [kMaxResponseSize]: 1024,
  [kQueue]: [],
  [kRunningIdx]: 0
}

describe('Parser#setTimeout WeakRef allocation', () => {
  beforeEach(() => jest.useFakeTimers('modern'))
  afterEach(() => jest.useRealTimers())

  it('reuses the parser WeakRef when replacing timers', async () => {
    const OriginalWeakRef = global.WeakRef
    let weakRefCount = 0

    global.WeakRef = class CountingWeakRef extends OriginalWeakRef {
      constructor (target) {
        weakRefCount++
        super(target)
      }
    }

    try {
      const socket = new DummySocket()
      await connectH1(dummyClient, socket)
      const parser = socket[kParser]

      parser.setTimeout(200, 0)
      parser.setTimeout(300, 0)
      parser.setTimeout(400, 1)

      expect(weakRefCount).toBe(1)
    } finally {
      global.WeakRef = OriginalWeakRef
    }
  })
})
