/** Expand the numeric legacy record's decimal representation without rounding it. */
export function plainPaperCash(value: number): string {
  const text = String(value)
  if (!Number.isFinite(value) || !/[eE]/.test(text)) return text
  const [coefficient, exponent] = text.toLowerCase().split('e')
  const sign = coefficient.startsWith('-') ? '-' : ''
  const [whole, fraction = ''] = coefficient.replace(/^-/, '').split('.')
  const digits = `${whole}${fraction}`
  const point = whole.length + Number(exponent)
  return (
    sign +
    (point <= 0
      ? `0.${'0'.repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`)
  )
}

/** Defaults must survive the legacy numeric profile/run field without precision loss. */
export function validPaperStartingCash(value: string): boolean {
  return (
    /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(value) &&
    Number(value) > 0 &&
    Number(value).toFixed(8) ===
      `${value.split('.')[0]}.${(value.split('.')[1] ?? '').padEnd(8, '0')}`
  )
}
