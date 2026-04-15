import assert from 'node:assert/strict'
import eventsourceStreamModule from '../../lib/web/eventsource/eventsource-stream.js'
import { bench, group, run } from 'mitata'

const { EventSourceStream } = eventsourceStreamModule

const noop = () => {}

const BOM_BYTES = [0xEF, 0xBB, 0xBF]
const LF = 0x0A
const CR = 0x0D
const COLON = 0x3A
const SPACE = 0x20

function isValidLastEventId (value) {
  return value.indexOf('\u0000') === -1
}

function isASCIINumber (value) {
  if (value.length === 0) return false
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x30 || value.charCodeAt(i) > 0x39) return false
  }
  return true
}

class LegacyEventSourceStream {
  checkBOM = true

  crlfCheck = false

  eventEndCheck = false

  buffer = null

  pos = 0

  event = {
    data: undefined,
    event: undefined,
    id: undefined,
    retry: undefined
  }

  constructor (options = {}) {
    this.state = options.eventSourceSettings || {}
  }

  _transform (chunk, _encoding, callback) {
    if (chunk.length === 0) {
      callback()
      return
    }

    if (this.buffer) {
      this.buffer = Buffer.concat([this.buffer, chunk])
    } else {
      this.buffer = chunk
    }

    if (this.checkBOM) {
      switch (this.buffer.length) {
        case 1:
          if (this.buffer[0] === BOM_BYTES[0]) {
            callback()
            return
          }

          this.checkBOM = false
          callback()
          return
        case 2:
          if (
            this.buffer[0] === BOM_BYTES[0] &&
            this.buffer[1] === BOM_BYTES[1]
          ) {
            callback()
            return
          }

          this.checkBOM = false
          break
        case 3:
          if (
            this.buffer[0] === BOM_BYTES[0] &&
            this.buffer[1] === BOM_BYTES[1] &&
            this.buffer[2] === BOM_BYTES[2]
          ) {
            this.buffer = Buffer.alloc(0)
            this.checkBOM = false
            callback()
            return
          }

          this.checkBOM = false
          break
        default:
          if (
            this.buffer[0] === BOM_BYTES[0] &&
            this.buffer[1] === BOM_BYTES[1] &&
            this.buffer[2] === BOM_BYTES[2]
          ) {
            this.buffer = this.buffer.subarray(3)
          }

          this.checkBOM = false
          break
      }
    }

    while (this.pos < this.buffer.length) {
      if (this.eventEndCheck) {
        if (this.crlfCheck) {
          if (this.buffer[this.pos] === LF) {
            this.buffer = this.buffer.subarray(this.pos + 1)
            this.pos = 0
            this.crlfCheck = false
            continue
          }

          this.crlfCheck = false
        }

        if (this.buffer[this.pos] === LF || this.buffer[this.pos] === CR) {
          if (this.buffer[this.pos] === CR) {
            this.crlfCheck = true
          }

          this.buffer = this.buffer.subarray(this.pos + 1)
          this.pos = 0
          if (
            this.event.data !== undefined ||
            this.event.event ||
            this.event.id !== undefined ||
            this.event.retry
          ) {
            this.processEvent(this.event)
          }
          this.clearEvent()
          continue
        }

        this.eventEndCheck = false
        continue
      }

      if (this.buffer[this.pos] === LF || this.buffer[this.pos] === CR) {
        if (this.buffer[this.pos] === CR) {
          this.crlfCheck = true
        }

        this.parseLine(this.buffer.subarray(0, this.pos), this.event)
        this.buffer = this.buffer.subarray(this.pos + 1)
        this.pos = 0
        this.eventEndCheck = true
        continue
      }

      this.pos++
    }

    callback()
  }

  parseLine (line, event) {
    if (line.length === 0) {
      return
    }

    const colonPosition = line.indexOf(COLON)
    if (colonPosition === 0) {
      return
    }

    let field = ''
    let value = ''

    if (colonPosition !== -1) {
      field = line.subarray(0, colonPosition).toString('utf8')

      let valueStart = colonPosition + 1
      if (line[valueStart] === SPACE) {
        ++valueStart
      }

      value = line.subarray(valueStart).toString('utf8')
    } else {
      field = line.toString('utf8')
      value = ''
    }

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

  processEvent (event) {
    if (event.retry && isASCIINumber(event.retry)) {
      this.state.reconnectionTime = parseInt(event.retry, 10)
    }

    if (event.id !== undefined && isValidLastEventId(event.id)) {
      this.state.lastEventId = event.id
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

function buildPayload ({ eventCount, includeBOM = false, unicode = false, eol = '\n' }) {
  let payload = includeBOM ? '\uFEFF' : ''

  for (let i = 0; i < eventCount; i++) {
    const primaryData = unicode
      ? `Grüße 😀 event ${i}`
      : `plain event ${i}`

    payload += `: keepalive ${i}${eol}`
    payload += `id: ${i}${eol}`
    payload += `event: update${eol}`
    payload += `retry: 1500${eol}`
    payload += `data: ${primaryData}${eol}`
    payload += `data: second line ${i}${eol}${eol}`
  }

  return Buffer.from(payload, 'utf8')
}

function fixedChunks (buffer, size) {
  const chunks = []

  for (let i = 0; i < buffer.length; i += size) {
    chunks.push(buffer.subarray(i, i + size))
  }

  return chunks
}

function patternedChunks (buffer, pattern) {
  const chunks = []

  for (let i = 0, offset = 0; offset < buffer.length; i++) {
    const size = pattern[i % pattern.length]
    chunks.push(buffer.subarray(offset, offset + size))
    offset += size
  }

  return chunks
}

function runScenario (StreamCtor, chunks) {
  const stream = new StreamCtor({
    eventSourceSettings: {
      origin: 'https://example.com',
      reconnectionTime: 1000
    }
  })

  let checksum = 0

  stream.processEvent = function (event) {
    if (event.retry && isASCIINumber(event.retry)) {
      this.state.reconnectionTime = parseInt(event.retry, 10)
    }

    if (event.id !== undefined && isValidLastEventId(event.id)) {
      this.state.lastEventId = event.id
    }

    if (event.data !== undefined) {
      checksum += event.data.length
      checksum += event.event ? event.event.length : 0
      checksum += this.state.lastEventId ? this.state.lastEventId.length : 0
      checksum += this.state.reconnectionTime || 0
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    stream._transform(chunks[i], 'buffer', noop)
  }

  return checksum
}

function buildParseLineInputs ({ recordCount, unicode = false }) {
  const inputs = []

  for (let i = 0; i < recordCount; i++) {
    const value = unicode
      ? `Grüße 😀 line ${i}`
      : `plain line ${i}`

    inputs.push(`id: ${i}`)
    inputs.push('event: update')
    inputs.push('retry: 1500')
    inputs.push(`data: ${value}`)
    inputs.push(`data: second ${i}`)
  }

  return inputs
}

function runCurrentParseLineScenario (inputs) {
  const stream = new EventSourceStream()
  let checksum = 0

  for (let i = 0; i < inputs.length; i += 5) {
    const event = {}

    stream.parseLine(inputs[i], event)
    stream.parseLine(inputs[i + 1], event)
    stream.parseLine(inputs[i + 2], event)
    stream.parseLine(inputs[i + 3], event)
    stream.parseLine(inputs[i + 4], event)

    checksum += event.data.length
    checksum += event.event.length
    checksum += event.id.length
    checksum += event.retry.length
  }

  return checksum
}

function runLegacyParseLineScenario (inputs) {
  const stream = new LegacyEventSourceStream()
  let checksum = 0

  for (let i = 0; i < inputs.length; i += 5) {
    const event = {}

    stream.parseLine(Buffer.from(inputs[i]), event)
    stream.parseLine(Buffer.from(inputs[i + 1]), event)
    stream.parseLine(Buffer.from(inputs[i + 2]), event)
    stream.parseLine(Buffer.from(inputs[i + 3]), event)
    stream.parseLine(Buffer.from(inputs[i + 4]), event)

    checksum += event.data.length
    checksum += event.event.length
    checksum += event.id.length
    checksum += event.retry.length
  }

  return checksum
}

const scenarios = {
  'ascii, 1-byte chunks': fixedChunks(buildPayload({ eventCount: 250 }), 1),
  'ascii, 32-byte chunks': fixedChunks(buildPayload({ eventCount: 250 }), 32),
  'utf8 + bom, mixed chunks': patternedChunks(
    buildPayload({
      eventCount: 250,
      includeBOM: true,
      unicode: true
    }),
    [1, 2, 3, 5, 8, 13, 21]
  )
}

const parseLineScenarios = {
  'parseLine, ascii fields': buildParseLineInputs({ recordCount: 1000 }),
  'parseLine, utf8 fields': buildParseLineInputs({ recordCount: 1000, unicode: true })
}

for (const [name, chunks] of Object.entries(scenarios)) {
  const legacyChecksum = runScenario(LegacyEventSourceStream, chunks)
  const currentChecksum = runScenario(EventSourceStream, chunks)

  assert.equal(currentChecksum, legacyChecksum, `${name} should preserve behavior`)
}

for (const [name, inputs] of Object.entries(parseLineScenarios)) {
  const legacyChecksum = runLegacyParseLineScenario(inputs)
  const currentChecksum = runCurrentParseLineScenario(inputs)

  assert.equal(currentChecksum, legacyChecksum, `${name} should preserve behavior`)
}

let blackhole = 0

for (const [name, chunks] of Object.entries(scenarios)) {
  group(name, () => {
    bench('legacy buffer parser', () => {
      blackhole ^= runScenario(LegacyEventSourceStream, chunks)
    })

    bench('current decoder parser', () => {
      blackhole ^= runScenario(EventSourceStream, chunks)
    })
  })
}

for (const [name, inputs] of Object.entries(parseLineScenarios)) {
  group(name, () => {
    bench('legacy parseLine', () => {
      blackhole ^= runLegacyParseLineScenario(inputs)
    })

    bench('current parseLine', () => {
      blackhole ^= runCurrentParseLineScenario(inputs)
    })
  })
}

await run()

if (blackhole === Number.MIN_SAFE_INTEGER) {
  console.log(blackhole)
}
