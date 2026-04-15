'use strict'

const { test, describe } = require('node:test')
const { EventSourceStream } = require('../../lib/web/eventsource/eventsource-stream')

describe('EventSourceStream - handle BOM', () => {
  test('Remove BOM from the beginning of the stream. 1 byte chunks', (t) => {
    const dataField = 'data: Hello'
    const content = Buffer.from(`\uFEFF${dataField}\n`, 'utf8')

    const stream = new EventSourceStream()
    let calls = 0

    stream.parseLine = function (line) {
      calls++
      t.assert.strictEqual(line, dataField)
    }

    for (let i = 0; i < content.length; i++) {
      stream.write(Buffer.from([content[i]]))
    }

    t.assert.strictEqual(calls, 1)
  })

  test('Remove BOM from the beginning of the stream. 2 byte chunks', (t) => {
    const dataField = 'data: Hello'
    const content = Buffer.from(`\uFEFF${dataField}\n`, 'utf8')

    const stream = new EventSourceStream()
    let calls = 0

    stream.parseLine = function (line) {
      calls++
      t.assert.strictEqual(line, dataField)
    }

    for (let i = 0; i < content.length; i += 2) {
      stream.write(Buffer.from([content[i], content[i + 1]]))
    }

    t.assert.strictEqual(calls, 1)
  })

  test('Remove BOM from the beginning of the stream. 3 byte chunks', (t) => {
    const dataField = 'data: Hello'
    const content = Buffer.from(`\uFEFF${dataField}\n`, 'utf8')

    const stream = new EventSourceStream()
    let calls = 0

    stream.parseLine = function (line) {
      calls++
      t.assert.strictEqual(line, dataField)
    }

    for (let i = 0; i < content.length; i += 3) {
      stream.write(Buffer.from([content[i], content[i + 1], content[i + 2]]))
    }

    t.assert.strictEqual(calls, 1)
  })

  test('Remove BOM from the beginning of the stream. 4 byte chunks', (t) => {
    const dataField = 'data: Hello'
    const content = Buffer.from(`\uFEFF${dataField}\n`, 'utf8')

    const stream = new EventSourceStream()
    let calls = 0

    stream.parseLine = function (line) {
      calls++
      t.assert.strictEqual(line, dataField)
    }

    for (let i = 0; i < content.length; i += 4) {
      stream.write(Buffer.from([content[i], content[i + 1], content[i + 2], content[i + 3]]))
    }

    t.assert.strictEqual(calls, 1)
  })

  test('Not containing BOM from the beginning of the stream. 1 byte chunks', (t) => {
    const dataField = 'data: Hello'
    const content = Buffer.from(`${dataField}\n`, 'utf8')

    const stream = new EventSourceStream()
    let calls = 0

    stream.parseLine = function (line) {
      calls++
      t.assert.strictEqual(line, dataField)
    }

    for (let i = 0; i < content.length; i += 1) {
      stream.write(Buffer.from([content[i]]))
    }

    t.assert.strictEqual(calls, 1)
  })

  test('Not containing BOM from the beginning of the stream. 2 byte chunks', (t) => {
    const dataField = 'data: Hello'
    const content = Buffer.from(`${dataField}\n`, 'utf8')

    const stream = new EventSourceStream()
    let calls = 0

    stream.parseLine = function (line) {
      calls++
      t.assert.strictEqual(line, dataField)
    }

    for (let i = 0; i < content.length; i += 2) {
      stream.write(Buffer.from([content[i], content[i + 1]]))
    }

    t.assert.strictEqual(calls, 1)
  })

  test('Not containing BOM from the beginning of the stream. 3 byte chunks', (t) => {
    const dataField = 'data: Hello'
    const content = Buffer.from(`${dataField}\n`, 'utf8')

    const stream = new EventSourceStream()
    let calls = 0

    stream.parseLine = function (line) {
      calls++
      t.assert.strictEqual(line, dataField)
    }

    for (let i = 0; i < content.length; i += 3) {
      stream.write(Buffer.from([content[i], content[i + 1], content[i + 2]]))
    }

    t.assert.strictEqual(calls, 1)
  })

  test('Not containing BOM from the beginning of the stream. 4 byte chunks', (t) => {
    const dataField = 'data: Hello'
    const content = Buffer.from(`${dataField}\n`, 'utf8')

    const stream = new EventSourceStream()
    let calls = 0

    stream.parseLine = function (line) {
      calls++
      t.assert.strictEqual(line, dataField)
    }

    for (let i = 0; i < content.length; i += 4) {
      stream.write(Buffer.from([content[i], content[i + 1], content[i + 2], content[i + 3]]))
    }

    t.assert.strictEqual(calls, 1)
  })
})
