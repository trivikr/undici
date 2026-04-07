import { bench, group, run } from 'mitata'
import { bufferToLowerCasedHeaderName } from '../lib/core/util.js'

const valueLength = parseInt(process.env.VALUE_LENGTH, 10) || 16 * 1024
const fieldFragmentSize = parseInt(process.env.FIELD_FRAGMENT_SIZE, 10) || 1

let sink = 0

class HeaderAccumulatorBase {
  constructor () {
    this.reset()
  }

  reset () {
    this.headers = []
    this.headersSize = 0
    this.keepAlive = ''
    this.connection = ''
    this.contentLength = ''
  }

  trackHeader (length) {
    this.headersSize += length
  }

  updateSpecialHeaders (key, buf) {
    if (key.length === 10) {
      const headerName = bufferToLowerCasedHeaderName(key)
      if (headerName === 'keep-alive') {
        this.keepAlive += buf.toString()
      } else if (headerName === 'connection') {
        this.connection += buf.toString()
      }
    } else if (key.length === 14 && bufferToLowerCasedHeaderName(key) === 'content-length') {
      this.contentLength += buf.toString()
    }
  }
}

class EagerConcatAccumulator extends HeaderAccumulatorBase {
  onHeaderField (buf) {
    const len = this.headers.length

    if ((len & 1) === 0) {
      this.headers.push(buf)
    } else {
      this.headers[len - 1] = Buffer.concat([this.headers[len - 1], buf])
    }

    this.trackHeader(buf.length)
  }

  onHeaderValue (buf) {
    let len = this.headers.length

    if ((len & 1) === 1) {
      this.headers.push(buf)
      len += 1
    } else {
      this.headers[len - 1] = Buffer.concat([this.headers[len - 1], buf])
    }

    this.updateSpecialHeaders(this.headers[len - 2], buf)
    this.trackHeader(buf.length)
  }

  finish () {
    const len = this.headers.length
    return this.headersSize +
      this.keepAlive.length +
      this.connection.length +
      this.contentLength.length +
      this.headers[len - 2].length +
      this.headers[len - 1].length
  }
}

class DeferredFlattenAccumulator extends HeaderAccumulatorBase {
  reset () {
    super.reset()
    this.currentHeaderIndex = -1
    this.headerFragments = null
    this.headerFragmentsSize = 0
  }

  onHeaderField (buf) {
    const len = this.headers.length

    if ((len & 1) === 0) {
      if (len !== 0) {
        this.flushHeader()
      }
      this.startHeader(buf)
    } else {
      this.appendHeader(buf)
    }

    this.trackHeader(buf.length)
  }

  onHeaderValue (buf) {
    const len = this.headers.length
    let key

    if ((len & 1) === 1) {
      key = this.flushHeader()
      this.startHeader(buf)
    } else {
      this.appendHeader(buf)
      key = this.headers[len - 2]
    }

    this.updateSpecialHeaders(key, buf)
    this.trackHeader(buf.length)
  }

  startHeader (buf) {
    this.headers.push(buf)
    this.currentHeaderIndex = this.headers.length - 1
    this.headerFragments = null
    this.headerFragmentsSize = 0
  }

  appendHeader (buf) {
    if (this.headerFragments === null) {
      const current = this.headers[this.currentHeaderIndex]
      this.headerFragments = [current, buf]
      this.headerFragmentsSize = current.length + buf.length
    } else {
      this.headerFragments.push(buf)
      this.headerFragmentsSize += buf.length
    }
  }

  flushHeader () {
    if (this.currentHeaderIndex === -1) {
      return null
    }

    if (this.headerFragments !== null) {
      const buf = Buffer.allocUnsafe(this.headerFragmentsSize)
      let offset = 0

      for (let i = 0; i < this.headerFragments.length; ++i) {
        const fragment = this.headerFragments[i]
        fragment.copy(buf, offset)
        offset += fragment.length
      }

      this.headers[this.currentHeaderIndex] = buf
      this.headerFragments = null
      this.headerFragmentsSize = 0
    }

    return this.headers[this.currentHeaderIndex]
  }

  finish () {
    this.flushHeader()

    const len = this.headers.length
    return this.headersSize +
      this.keepAlive.length +
      this.connection.length +
      this.contentLength.length +
      this.headers[len - 2].length +
      this.headers[len - 1].length
  }
}

function fragmentBuffer (value, fragmentSize) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const fragments = []

  for (let i = 0; i < buffer.length; i += fragmentSize) {
    fragments.push(buffer.subarray(i, i + fragmentSize))
  }

  return fragments
}

function buildScenario ({ fragmentedField, valueFragmentSize }) {
  const customField = fragmentBuffer('x-benchmark-fragmented-header', fragmentedField ? fieldFragmentSize : 64)
  const customValue = fragmentBuffer('a'.repeat(valueLength), valueFragmentSize)

  return [
    {
      field: fragmentBuffer('connection', fragmentedField ? fieldFragmentSize : 64),
      value: fragmentBuffer('keep-alive', valueFragmentSize)
    },
    {
      field: customField,
      value: customValue
    },
    {
      field: fragmentBuffer('content-length', fragmentedField ? fieldFragmentSize : 64),
      value: fragmentBuffer(String(valueLength), valueFragmentSize)
    }
  ]
}

function runScenario (accumulator, scenario) {
  accumulator.reset()

  for (let i = 0; i < scenario.length; ++i) {
    const header = scenario[i]

    for (let j = 0; j < header.field.length; ++j) {
      accumulator.onHeaderField(header.field[j])
    }

    for (let j = 0; j < header.value.length; ++j) {
      accumulator.onHeaderValue(header.value[j])
    }
  }

  sink ^= accumulator.finish()
}

const scenarios = {
  'field fragmented, value fragmented byte-by-byte': buildScenario({
    fragmentedField: true,
    valueFragmentSize: 1
  }),
  'field fragmented, value fragmented in 16-byte chunks': buildScenario({
    fragmentedField: true,
    valueFragmentSize: 16
  }),
  'field contiguous, value fragmented byte-by-byte': buildScenario({
    fragmentedField: false,
    valueFragmentSize: 1
  })
}

for (const [name, scenario] of Object.entries(scenarios)) {
  const eager = new EagerConcatAccumulator()
  const deferred = new DeferredFlattenAccumulator()

  group(`${name} (value length ${valueLength})`, () => {
    bench('legacy eager Buffer.concat', () => {
      runScenario(eager, scenario)
    })

    bench('deferred flatten', () => {
      runScenario(deferred, scenario)
    })
  })
}

await run()

if (sink === Number.MIN_SAFE_INTEGER) {
  console.log('unreachable', sink)
}
