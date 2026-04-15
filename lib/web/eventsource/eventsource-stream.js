'use strict'
const { Transform } = require('node:stream')
const { StringDecoder } = require('node:string_decoder')
const { isASCIINumber, isValidLastEventId } = require('./util')

/**
 * @type {'\uFEFF'} BOM
 */
const BOM = '\uFEFF'
/**
 * @type {'\n'} LF
 */
const LF = '\n'
/**
 * @type {'\r'} CR
 */
const CR = '\r'
/**
 * @type {':'} COLON
 */
const COLON = ':'
/**
 * @type {' '} SPACE
 */
const SPACE = ' '

/**
 * @typedef {object} EventSourceStreamEvent
 * @type {object}
 * @property {string} [event] The event type.
 * @property {string} [data] The data of the message.
 * @property {string} [id] A unique ID for the event.
 * @property {string} [retry] The reconnection time, in milliseconds.
 */

/**
 * @typedef eventSourceSettings
 * @type {object}
 * @property {string} [lastEventId] The last event ID received from the server.
 * @property {string} [origin] The origin of the event source.
 * @property {number} [reconnectionTime] The reconnection time, in milliseconds.
 */

class EventSourceStream extends Transform {
  /**
   * @type {eventSourceSettings}
   */
  state

  /**
   * Leading byte-order-mark check.
   * @type {boolean}
   */
  checkBOM = true

  /**
   * Stores the partial line between chunks.
   * @type {string}
   */
  buffer = ''

  /**
   * Decodes UTF-8 without splitting multibyte code points across chunks.
   * @type {StringDecoder}
   */
  decoder = new StringDecoder('utf8')

  event = {
    data: undefined,
    event: undefined,
    id: undefined,
    retry: undefined
  }

  /**
   * @param {object} options
   * @param {boolean} [options.readableObjectMode]
   * @param {eventSourceSettings} [options.eventSourceSettings]
   * @param {(chunk: any, encoding?: BufferEncoding | undefined) => boolean} [options.push]
   */
  constructor (options = {}) {
    // Enable object mode as EventSourceStream emits objects of shape
    // EventSourceStreamEvent
    options.readableObjectMode = true

    super(options)

    this.state = options.eventSourceSettings || {}
    if (options.push) {
      this.push = options.push
    }
  }

  /**
   * @param {Buffer} chunk
   * @param {string} _encoding
   * @param {Function} callback
   * @returns {void}
   */
  _transform (chunk, _encoding, callback) {
    if (chunk.length === 0) {
      callback()
      return
    }

    let data = this.decoder.write(chunk)

    // Wait until the UTF-8 decoder has enough bytes to emit characters.
    if (data.length === 0) {
      callback()
      return
    }

    // Strip the leading byte-order-mark once we have decoded the first
    // characters of the stream.
    if (this.checkBOM) {
      this.checkBOM = false

      if (data[0] === BOM) {
        data = data.slice(1)

        if (data.length === 0) {
          callback()
          return
        }
      }
    }

    if (this.buffer.length !== 0) {
      data = this.buffer + data
    }

    let lineStart = 0

    for (let i = 0; i < data.length; i++) {
      const char = data[i]

      if (char !== LF && char !== CR) {
        continue
      }

      const line = data.slice(lineStart, i)

      if (line.length === 0) {
        if (
          this.event.data !== undefined ||
          this.event.event ||
          this.event.id !== undefined ||
          this.event.retry
        ) {
          this.processEvent(this.event)
        }

        this.clearEvent()
      } else {
        this.parseLine(line, this.event)
      }

      if (char === CR && data[i + 1] === LF) {
        i++
      }

      lineStart = i + 1
    }

    this.buffer = data.slice(lineStart)
    callback()
  }

  /**
   * @param {Buffer|string} line
   * @param {EventSourceStreamEvent} event
   */
  parseLine (line, event) {
    if (typeof line !== 'string') {
      line = line.toString('utf8')
    }

    // If the line is empty (a blank line)
    // Dispatch the event, as defined below.
    // This will be handled in the _transform method
    if (line.length === 0) {
      return
    }

    // If the line starts with a U+003A COLON character (:)
    // Ignore the line.
    const colonPosition = line.indexOf(COLON)
    if (colonPosition === 0) {
      return
    }

    let field = ''
    let value = ''

    // If the line contains a U+003A COLON character (:)
    if (colonPosition !== -1) {
      // Collect the characters on the line before the first U+003A COLON
      // character (:), and let field be that string.
      field = line.slice(0, colonPosition)

      // Collect the characters on the line after the first U+003A COLON
      // character (:), and let value be that string.
      // If value starts with a U+0020 SPACE character, remove it from value.
      let valueStart = colonPosition + 1
      if (line[valueStart] === SPACE) {
        ++valueStart
      }
      value = line.slice(valueStart)

      // Otherwise, the string is not empty but does not contain a U+003A COLON
      // character (:)
    } else {
      // Process the field using the steps described below, using the whole
      // line as the field name, and the empty string as the field value.
      field = line
      value = ''
    }

    // Modify the event with the field name and value. The value is also
    // decoded as UTF-8
    switch (field) {
      case 'data':
        if (event[field] === undefined) {
          event[field] = value
        } else {
          event[field] += `\n${value}`
        }
        break
      case 'retry':
        if (isASCIINumber(value)) {
          event[field] = value
        }
        break
      case 'id':
        if (isValidLastEventId(value)) {
          event[field] = value
        }
        break
      case 'event':
        if (value.length > 0) {
          event[field] = value
        }
        break
    }
  }

  /**
   * @param {EventSourceStreamEvent} event
   */
  processEvent (event) {
    if (event.retry && isASCIINumber(event.retry)) {
      this.state.reconnectionTime = parseInt(event.retry, 10)
    }

    if (event.id !== undefined && isValidLastEventId(event.id)) {
      this.state.lastEventId = event.id
    }

    // only dispatch event, when data is provided
    if (event.data !== undefined) {
      this.push({
        type: event.event || 'message',
        options: {
          data: event.data,
          lastEventId: this.state.lastEventId,
          origin: this.state.origin
        }
      })
    }
  }

  clearEvent () {
    this.event = {
      data: undefined,
      event: undefined,
      id: undefined,
      retry: undefined
    }
  }
}

module.exports = {
  EventSourceStream
}
