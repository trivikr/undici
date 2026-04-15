'use strict'

const { RequestAbortedError } = require('../core/errors')

/**
 * @typedef {import('../../types/dispatcher.d.ts').default.DispatchHandler} DispatchHandler
 */

const DEFAULT_MAX_BUFFER_SIZE = 5 * 1024 * 1024

/**
 * @typedef {Object} WaitingHandler
 * @property {DispatchHandler} handler
 * @property {import('../../types/dispatcher.d.ts').default.DispatchController} controller
 * @property {number} readIndex
 * @property {number} bufferedBytes
 * @property {object | null} pendingTrailers
 * @property {boolean} done
 */

/**
 * @typedef {Object} RetainedChunk
 * @property {Buffer} chunk
 * @property {number} refs
 */

/**
 * Handler that forwards response events to multiple waiting handlers.
 * Used for request deduplication.
 *
 * @implements {DispatchHandler}
 */
class DeduplicationHandler {
  /**
   * @type {DispatchHandler}
   */
  #primaryHandler

  /**
   * @type {WaitingHandler[]}
   */
  #waitingHandlers = []

  /**
   * @type {number}
   */
  #waitingHandlersHead = 0

  /**
   * @type {RetainedChunk[]}
   */
  #retainedChunks = []

  /**
   * @type {number}
   */
  #retainedChunksHead = 0

  /**
   * @type {number}
   */
  #retainedChunksHeadIndex = 0

  /**
   * @type {number}
   */
  #maxBufferSize = DEFAULT_MAX_BUFFER_SIZE

  /**
   * @type {number}
   */
  #statusCode = 0

  /**
   * @type {Record<string, string | string[]>}
   */
  #headers = {}

  /**
   * @type {string}
   */
  #statusMessage = ''

  /**
   * @type {boolean}
   */
  #aborted = false

  /**
   * @type {boolean}
   */
  #responseStarted = false

  /**
   * @type {boolean}
   */
  #responseDataStarted = false

  /**
   * @type {boolean}
   */
  #completed = false

  /**
   * @type {import('../../types/dispatcher.d.ts').default.DispatchController | null}
   */
  #controller = null

  /**
   * @type {(() => void) | null}
   */
  #onComplete = null

  /**
   * @param {DispatchHandler} primaryHandler The primary handler
   * @param {() => void} onComplete Callback when request completes
   * @param {number} [maxBufferSize] Maximum paused buffer size per waiting handler
   */
  constructor (primaryHandler, onComplete, maxBufferSize = DEFAULT_MAX_BUFFER_SIZE) {
    this.#primaryHandler = primaryHandler
    this.#onComplete = onComplete
    this.#maxBufferSize = maxBufferSize
  }

  /**
   * Add a waiting handler that will receive response events.
   * Returns false if deduplication can no longer safely attach this handler.
   *
   * @param {DispatchHandler} handler
   * @returns {boolean}
   */
  addWaitingHandler (handler) {
    if (this.#completed || this.#responseDataStarted) {
      return false
    }

    const waitingHandler = this.#createWaitingHandler(handler)
    const waitingController = waitingHandler.controller

    try {
      handler.onRequestStart?.(waitingController, null)

      if (waitingController.aborted) {
        waitingHandler.done = true
        return true
      }

      if (this.#responseStarted) {
        handler.onResponseStart?.(
          waitingController,
          this.#statusCode,
          this.#headers,
          this.#statusMessage
        )
      }
    } catch {
      // Ignore errors from waiting handlers
      waitingHandler.done = true
      return true
    }

    if (!waitingController.aborted) {
      this.#waitingHandlers.push(waitingHandler)
    }

    return true
  }

  /**
   * @param {import('../../types/dispatcher.d.ts').default.DispatchController} controller
   * @param {any} context
   */
  onRequestStart (controller, context) {
    this.#controller = controller
    this.#primaryHandler.onRequestStart?.(controller, context)
  }

  /**
   * @param {import('../../types/dispatcher.d.ts').default.DispatchController} controller
   * @param {number} statusCode
   * @param {import('../../types/header.d.ts').IncomingHttpHeaders} headers
   * @param {Socket} socket
   */
  onRequestUpgrade (controller, statusCode, headers, socket) {
    this.#primaryHandler.onRequestUpgrade?.(controller, statusCode, headers, socket)
  }

  /**
   * @param {import('../../types/dispatcher.d.ts').default.DispatchController} controller
   * @param {number} statusCode
   * @param {Record<string, string | string[]>} headers
   * @param {string} statusMessage
   */
  onResponseStart (controller, statusCode, headers, statusMessage) {
    this.#responseStarted = true
    this.#statusCode = statusCode
    this.#headers = headers
    this.#statusMessage = statusMessage

    this.#primaryHandler.onResponseStart?.(controller, statusCode, headers, statusMessage)

    for (let i = this.#waitingHandlersHead; i < this.#waitingHandlers.length; i++) {
      const waitingHandler = this.#waitingHandlers[i]
      const { handler, controller: waitingController } = waitingHandler

      if (waitingHandler.done || waitingController.aborted) {
        waitingHandler.done = true
        continue
      }

      try {
        handler.onResponseStart?.(
          waitingController,
          statusCode,
          headers,
          statusMessage
        )
      } catch {
        // Ignore errors from waiting handlers
      }

      if (waitingController.aborted) {
        waitingHandler.done = true
      }
    }

    this.#pruneDoneWaitingHandlers()
  }

  /**
   * @param {import('../../types/dispatcher.d.ts').default.DispatchController} controller
   * @param {Buffer} chunk
   */
  onResponseData (controller, chunk) {
    if (this.#aborted || this.#completed) {
      return
    }

    this.#responseDataStarted = true

    this.#primaryHandler.onResponseData?.(controller, chunk)

    let retainedChunk = null
    let retainedChunkIndex = -1

    for (let i = this.#waitingHandlersHead; i < this.#waitingHandlers.length; i++) {
      const waitingHandler = this.#waitingHandlers[i]
      const { handler, controller: waitingController } = waitingHandler

      if (waitingHandler.done || waitingController.aborted) {
        waitingHandler.done = true
        continue
      }

      if (waitingController.paused) {
        if (retainedChunk === null) {
          retainedChunkIndex = this.#appendRetainedChunk(chunk)
          retainedChunk = this.#getRetainedChunk(retainedChunkIndex)
        }

        this.#bufferWaitingChunk(waitingHandler, retainedChunkIndex, retainedChunk)
        continue
      }

      try {
        handler.onResponseData?.(waitingController, chunk)
      } catch {
        // Ignore errors from waiting handlers
      }

      if (waitingController.aborted) {
        this.#finishWaitingHandler(waitingHandler)
      }
    }

    this.#pruneDoneWaitingHandlers()
  }

  /**
   * @param {import('../../types/dispatcher.d.ts').default.DispatchController} controller
   * @param {object} trailers
   */
  onResponseEnd (controller, trailers) {
    if (this.#aborted || this.#completed) {
      return
    }

    this.#completed = true
    this.#primaryHandler.onResponseEnd?.(controller, trailers)

    for (let i = this.#waitingHandlersHead; i < this.#waitingHandlers.length; i++) {
      const waitingHandler = this.#waitingHandlers[i]
      if (waitingHandler.done || waitingHandler.controller.aborted) {
        waitingHandler.done = true
        continue
      }

      this.#flushWaitingHandler(waitingHandler)

      if (waitingHandler.done || waitingHandler.controller.aborted) {
        waitingHandler.done = true
        continue
      }

      if (waitingHandler.controller.paused && waitingHandler.readIndex !== -1) {
        waitingHandler.pendingTrailers = trailers
        continue
      }

      try {
        waitingHandler.handler.onResponseEnd?.(waitingHandler.controller, trailers)
      } catch {
        // Ignore errors from waiting handlers
      }

      this.#finishWaitingHandler(waitingHandler)
    }

    this.#pruneDoneWaitingHandlers()
    this.#onComplete?.()
  }

  /**
   * @param {import('../../types/dispatcher.d.ts').default.DispatchController} controller
   * @param {Error} err
   */
  onResponseError (controller, err) {
    if (this.#completed) {
      return
    }

    this.#aborted = true
    this.#completed = true

    this.#primaryHandler.onResponseError?.(controller, err)

    for (let i = this.#waitingHandlersHead; i < this.#waitingHandlers.length; i++) {
      const waitingHandler = this.#waitingHandlers[i]
      this.#errorWaitingHandler(waitingHandler, err)
    }

    this.#waitingHandlers = []
    this.#waitingHandlersHead = 0
    this.#retainedChunks = []
    this.#retainedChunksHead = 0
    this.#retainedChunksHeadIndex = 0
    this.#onComplete?.()
  }

  /**
   * @param {DispatchHandler} handler
   * @returns {WaitingHandler}
   */
  #createWaitingHandler (handler) {
    /** @type {WaitingHandler} */
    const waitingHandler = {
      handler,
      controller: null,
      readIndex: -1,
      bufferedBytes: 0,
      pendingTrailers: null,
      done: false
    }

    const state = {
      aborted: false,
      paused: false,
      reason: null
    }

    waitingHandler.controller = {
      resume: () => {
        if (state.aborted) {
          return
        }

        state.paused = false
        this.#flushWaitingHandler(waitingHandler)

        if (
          this.#completed &&
          waitingHandler.pendingTrailers &&
          waitingHandler.readIndex === -1 &&
          !state.paused &&
          !state.aborted
        ) {
          const pendingTrailers = waitingHandler.pendingTrailers
          waitingHandler.pendingTrailers = null

          try {
            waitingHandler.handler.onResponseEnd?.(waitingHandler.controller, pendingTrailers)
          } catch {
            // Ignore errors from waiting handlers
          }

          this.#finishWaitingHandler(waitingHandler)
        }

        this.#pruneDoneWaitingHandlers()
      },
      pause: () => {
        if (!state.aborted) {
          state.paused = true
        }
      },
      get paused () { return state.paused },
      get aborted () { return state.aborted },
      get reason () { return state.reason },
      abort: (reason) => {
        state.aborted = true
        state.reason = reason ?? null
        this.#finishWaitingHandler(waitingHandler)
      }
    }

    return waitingHandler
  }

  /**
   * @param {WaitingHandler} waitingHandler
   * @param {number} retainedChunkIndex
   * @param {RetainedChunk} retainedChunk
   */
  #bufferWaitingChunk (waitingHandler, retainedChunkIndex, retainedChunk) {
    if (waitingHandler.done || waitingHandler.controller.aborted) {
      this.#finishWaitingHandler(waitingHandler)
      return
    }

    if (waitingHandler.readIndex === -1) {
      waitingHandler.readIndex = retainedChunkIndex
    }

    retainedChunk.refs++
    waitingHandler.bufferedBytes += retainedChunk.chunk.length

    if (waitingHandler.bufferedBytes > this.#maxBufferSize) {
      const err = new RequestAbortedError(`Deduplicated waiting handler exceeded maxBufferSize (${this.#maxBufferSize} bytes) while paused`)
      this.#errorWaitingHandler(waitingHandler, err)
    }
  }

  /**
   * @param {WaitingHandler} waitingHandler
   */
  #flushWaitingHandler (waitingHandler) {
    const { handler, controller } = waitingHandler

    while (
      !waitingHandler.done &&
      !controller.aborted &&
      !controller.paused &&
      waitingHandler.readIndex !== -1
    ) {
      const retainedChunk = this.#getRetainedChunk(waitingHandler.readIndex)
      const bufferedChunk = retainedChunk.chunk
      waitingHandler.bufferedBytes -= bufferedChunk.length
      waitingHandler.readIndex++

      if (waitingHandler.readIndex === this.#retainedChunksTailIndex()) {
        waitingHandler.readIndex = -1
      }

      try {
        handler.onResponseData?.(controller, bufferedChunk)
      } catch {
        // Ignore errors from waiting handlers
      }

      retainedChunk.refs--

      if (controller.aborted) {
        this.#finishWaitingHandler(waitingHandler)
        break
      }
    }

    this.#trimRetainedChunks()
  }

  /**
   * @param {WaitingHandler} waitingHandler
   * @param {Error} err
   */
  #errorWaitingHandler (waitingHandler, err) {
    if (waitingHandler.done) {
      return
    }

    try {
      waitingHandler.controller.abort(err)
      waitingHandler.handler.onResponseError?.(waitingHandler.controller, err)
    } catch {
      // Ignore errors from waiting handlers
    }
  }

  #pruneDoneWaitingHandlers () {
    while (
      this.#waitingHandlersHead < this.#waitingHandlers.length &&
      this.#waitingHandlers[this.#waitingHandlersHead].done
    ) {
      this.#waitingHandlersHead++
    }

    if (this.#waitingHandlersHead === 0) {
      return
    }

    if (
      this.#waitingHandlersHead >= this.#waitingHandlers.length ||
      this.#waitingHandlersHead > 32
    ) {
      let write = 0

      for (let read = this.#waitingHandlersHead; read < this.#waitingHandlers.length; read++) {
        const waitingHandler = this.#waitingHandlers[read]

        if (waitingHandler.done === false) {
          this.#waitingHandlers[write++] = waitingHandler
        }
      }

      this.#waitingHandlers.length = write
      this.#waitingHandlersHead = 0
    }
  }

  #finishWaitingHandler (waitingHandler) {
    if (waitingHandler.done) {
      return
    }

    waitingHandler.done = true
    waitingHandler.pendingTrailers = null
    this.#releaseWaitingHandlerBufferedChunks(waitingHandler)
  }

  /**
   * @param {Buffer} chunk
   * @returns {number}
   */
  #appendRetainedChunk (chunk) {
    const retainedChunkIndex = this.#retainedChunksTailIndex()
    this.#retainedChunks.push({
      chunk: Buffer.from(chunk),
      refs: 0
    })
    return retainedChunkIndex
  }

  /**
   * @param {number} retainedChunkIndex
   * @returns {RetainedChunk}
   */
  #getRetainedChunk (retainedChunkIndex) {
    return this.#retainedChunks[
      this.#retainedChunksHead + (retainedChunkIndex - this.#retainedChunksHeadIndex)
    ]
  }

  /**
   * @param {WaitingHandler} waitingHandler
   */
  #releaseWaitingHandlerBufferedChunks (waitingHandler) {
    if (waitingHandler.readIndex === -1) {
      waitingHandler.bufferedBytes = 0
      return
    }

    const retainedChunksTailIndex = this.#retainedChunksTailIndex()

    for (let readIndex = waitingHandler.readIndex; readIndex < retainedChunksTailIndex; readIndex++) {
      const retainedChunk = this.#getRetainedChunk(readIndex)
      retainedChunk.refs--
    }

    waitingHandler.readIndex = -1
    waitingHandler.bufferedBytes = 0
    this.#trimRetainedChunks()
  }

  #retainedChunksTailIndex () {
    return this.#retainedChunksHeadIndex + (this.#retainedChunks.length - this.#retainedChunksHead)
  }

  #trimRetainedChunks () {
    while (
      this.#retainedChunksHead < this.#retainedChunks.length &&
      this.#retainedChunks[this.#retainedChunksHead].refs === 0
    ) {
      this.#retainedChunksHead++
      this.#retainedChunksHeadIndex++
    }

    if (this.#retainedChunksHead === 0) {
      return
    }

    if (
      this.#retainedChunksHead >= this.#retainedChunks.length ||
      this.#retainedChunksHead > 32
    ) {
      this.#retainedChunks = this.#retainedChunks.slice(this.#retainedChunksHead)
      this.#retainedChunksHead = 0
    }
  }
}

module.exports = DeduplicationHandler
