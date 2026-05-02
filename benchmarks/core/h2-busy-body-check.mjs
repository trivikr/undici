import { PassThrough } from 'node:stream'
import { bench, do_not_optimize as doNotOptimize, group, run } from 'mitata'
import {
  bodyLength,
  isAsyncIterable,
  isFormDataLike,
  isStream
} from '../../lib/core/util.js'

const noBody = null
const buffer = Buffer.alloc(1024)
const blob = new Blob([buffer])
const stream = new PassThrough()
const asyncIterable = {
  async * [Symbol.asyncIterator] () {
    yield buffer
  }
}
const formDataLike = {
  append () {},
  delete () {},
  get () {},
  getAll () {},
  has () {},
  set () {},
  [Symbol.toStringTag]: 'FormData'
}

function previousBusyBodyCheck (body) {
  return bodyLength(body) !== 0 &&
    (isStream(body) || isAsyncIterable(body) || isFormDataLike(body))
}

function currentBusyBodyCheck (body) {
  return body != null &&
    (isStream(body) || isAsyncIterable(body) || isFormDataLike(body)) &&
    bodyLength(body) !== 0
}

group('h2 busy body check - previous', () => {
  bench('GET/no body', () => {
    doNotOptimize(previousBusyBodyCheck(noBody))
  })

  bench('buffer', () => {
    doNotOptimize(previousBusyBodyCheck(buffer))
  })

  bench('blob', () => {
    doNotOptimize(previousBusyBodyCheck(blob))
  })

  bench('stream', () => {
    doNotOptimize(previousBusyBodyCheck(stream))
  })

  bench('async iterable', () => {
    doNotOptimize(previousBusyBodyCheck(asyncIterable))
  })

  bench('form data like', () => {
    doNotOptimize(previousBusyBodyCheck(formDataLike))
  })
})

group('h2 busy body check - current', () => {
  bench('GET/no body', () => {
    doNotOptimize(currentBusyBodyCheck(noBody))
  })

  bench('buffer', () => {
    doNotOptimize(currentBusyBodyCheck(buffer))
  })

  bench('blob', () => {
    doNotOptimize(currentBusyBodyCheck(blob))
  })

  bench('stream', () => {
    doNotOptimize(currentBusyBodyCheck(stream))
  })

  bench('async iterable', () => {
    doNotOptimize(currentBusyBodyCheck(asyncIterable))
  })

  bench('form data like', () => {
    doNotOptimize(currentBusyBodyCheck(formDataLike))
  })
})

await run()
