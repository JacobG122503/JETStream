/**
 * Exact integer arithmetic. Every amount, rate, quantity and percentage in JET Time is an integer
 * in its own small unit (see docs/data-model.md), so sums and products never go through floating
 * point. Products are taken as BigInt and rounded once, half away from zero.
 */

/** 100% as integer thousandths of a percent. */
export const wholePercent = 100_000
/** A quantity of 1, and one minor unit in an expense unit price. */
export const thousand = 1000
export const minutesPerHour = 60

export class CalculationError extends Error {
  override name = 'CalculationError'
}

export function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new CalculationError(`${name} must be a whole number, not ${value}.`)
}

export function assertNotNegative(value: number, name: string): void {
  assertInteger(value, name)
  if (value < 0) throw new CalculationError(`${name} must not be negative: ${value}.`)
}

/** A percentage in thousandths: 8.25% is 8250. From 0 to 100%. */
export function assertPercent(value: number, name: string): void {
  assertNotNegative(value, name)
  if (value > wholePercent) throw new CalculationError(`${name} must not be over 100%: ${value}.`)
}

/** The result as a number, or an error when it could not be exact. */
export function toSafeNumber(value: bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new CalculationError(`The result ${value} is too large to be exact.`)
  return result
}

/** numerator / denominator, rounded half away from zero. The denominator is positive. */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const magnitude = numerator < 0n ? -numerator : numerator
  const rounded = (magnitude * 2n + denominator) / (denominator * 2n)
  return numerator < 0n ? -rounded : rounded
}

/** a × b ÷ divisor, rounded once. */
export function multiplyDivide(a: number, b: number, divisor: number): number {
  return toSafeNumber(divideRounded(BigInt(a) * BigInt(b), BigInt(divisor)))
}

/** The exact sum. */
export function sumIntegers(values: Iterable<number>, name = 'Value'): number {
  let total = 0n
  for (const value of values) {
    assertInteger(value, name)
    total += BigInt(value)
  }
  return toSafeNumber(total)
}
