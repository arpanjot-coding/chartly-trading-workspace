/** Reference reader for the standalone Chartly chart-study protocol v1. */
import { stdin, stdout } from 'node:process'

const maxBytes = 1_048_576
const maxCandles = 4096
const maxValue = 1_000_000_000_000
const maxTime = 253402300799
const idPattern = /^[A-Za-z][A-Za-z0-9._-]{0,63}(?![\s\S])/u
const requestFields = ['version', 'id', 'method', 'study', 'parameters', 'candles']
const candleFields = ['time', 'open', 'high', 'low', 'close', 'volume']
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

const identifier = (value) => typeof value === 'string' && idPattern.test(value)
const number = (value, min, max) => typeof value === 'number' && value >= min && value <= max
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactFields = (value, fields) =>
  record(value) &&
  Object.keys(value).length === fields.length &&
  fields.every((key) => Object.hasOwn(value, key))
const fail = (code, id = null) => ({ version: 1, id, error: { code } })

function validCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 1 || candles.length > maxCandles) return false
  let previousTime = -1
  for (const candle of candles) {
    if (!exactFields(candle, candleFields)) return false
    const { time, open, high, low, close, volume } = candle
    if (!integer(time, 0, maxTime) || time <= previousTime) return false
    if (![open, high, low, close].every((value) => number(value, -maxValue, maxValue))) return false
    if (low > Math.min(open, close) || high < Math.max(open, close) || !number(volume, 0, maxValue)) {
      return false
    }
    previousTime = time
  }
  return true
}

function accumulate(sum, value) {
  const updated = sum.total + value
  if (Math.abs(sum.total) >= Math.abs(value)) sum.correction += (sum.total - updated) + value
  else sum.correction += (value - updated) + sum.total
  sum.total = updated
}

function evaluate(raw) {
  let request
  try {
    request = JSON.parse(decoder.decode(raw))
  } catch {
    return fail('request.invalid_json')
  }
  if (!record(request) || !identifier(request.id)) return fail('request.invalid')
  const { version, id, method, study, parameters, candles } = request
  if (version !== 1) return fail('request.unsupported_version', id)
  if (
    !exactFields(request, requestFields) ||
    method !== 'study.evaluate' ||
    !identifier(study) ||
    !record(parameters)
  ) {
    return fail('request.invalid', id)
  }
  if (study !== 'sma.close') return fail('study.unsupported', id)
  if (!exactFields(parameters, ['period']) || !integer(parameters.period, 1, maxCandles)) {
    return fail('study.invalid_parameters', id)
  }
  if (!validCandles(candles)) return fail('study.invalid_candles', id)

  const { period } = parameters
  const sum = { total: 0, correction: 0 }
  const points = candles.map(({ time, close }, index) => {
    if (index >= period) {
      accumulate(sum, -candles[index - period].close)
    }
    accumulate(sum, close)
    const value =
      index + 1 >= period
        ? Math.max(-maxValue, Math.min(maxValue, (sum.total + sum.correction) / period))
        : null
    return { time, value }
  })
  return { version: 1, id, series: [{ id: 'sma', points }] }
}

async function write(reply) {
  await new Promise((resolve, reject) => {
    stdout.write(`${JSON.stringify(reply)}\n`, (error) => (error ? reject(error) : resolve()))
  })
}

// A fixed buffer holds a single capped frame, including an optional CR before LF.
const buffer = Buffer.alloc(maxBytes + 1)
let size = 0
let oversized = false

function append(bytes) {
  if (oversized || size + bytes.length > buffer.length) {
    oversized = true
    return
  }
  bytes.copy(buffer, size)
  size += bytes.length
}

async function finish(terminated) {
  if (terminated && size > 0 && buffer[size - 1] === 13) size--
  const reply =
    oversized || size > maxBytes ? fail('request.too_large') : evaluate(buffer.subarray(0, size))
  size = 0
  oversized = false
  await write(reply)
}

for await (const chunk of stdin) {
  let start = 0
  let newline = chunk.indexOf(10, start)
  while (newline !== -1) {
    append(chunk.subarray(start, newline))
    await finish(true)
    start = newline + 1
    newline = chunk.indexOf(10, start)
  }
  append(chunk.subarray(start))
}
if (size > 0 || oversized) await finish(false)
