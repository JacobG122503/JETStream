/** Totals of invoices and estimates. */
import { timeAmount } from './amounts'
import {
  assertInteger, assertNotNegative, assertPercent, divideRounded, multiplyDivide, sumIntegers, thousand, toSafeNumber,
  wholePercent,
} from './integers'

export interface DocumentLine {
  /** Thousandths; may be negative. Only shown when the line has minutes. */
  quantity: number
  /** Minor units; may be negative. */
  unitPrice: number
  /** Set on lines of time: the amount is then taken from the minutes, not the quantity. */
  minutes?: number | null
  tax1: boolean
  tax2: boolean
}

export interface DocumentRates {
  /** Thousandths of a percent; null and 0 mean none. */
  discountPercent: number | null
  tax1Percent: number | null
  tax2Percent: number | null
}

export interface DocumentTotals {
  /** In the order of the lines. */
  lineAmounts: number[]
  subtotal: number
  /** Taken off the subtotal. */
  discount: number
  tax1: number
  tax2: number
  total: number
}

export function lineAmount({ quantity, unitPrice, minutes }: DocumentLine): number {
  assertInteger(quantity, 'Quantity')
  assertInteger(unitPrice, 'Unit price')
  if (minutes !== undefined && minutes !== null) return timeAmount(minutes, unitPrice)
  return multiplyDivide(quantity, unitPrice, thousand)
}

export function documentTotals(lines: readonly DocumentLine[], rates: DocumentRates): DocumentTotals {
  const discountPercent = rates.discountPercent ?? 0
  assertPercent(discountPercent, 'Discount')
  const lineAmounts = lines.map(lineAmount)
  const subtotal = sumIntegers(lineAmounts)
  const discount = multiplyDivide(subtotal, discountPercent, wholePercent)

  // The discount and the tax are applied in one step and rounded once. Taxes do not compound.
  const tax = (flag: 'tax1' | 'tax2', percent: number) => {
    assertPercent(percent, 'Tax')
    const taxable = sumIntegers(lineAmounts.filter((_amount, index) => lines[index]?.[flag]))
    const numerator = BigInt(taxable) * BigInt(wholePercent - discountPercent) * BigInt(percent)
    return toSafeNumber(divideRounded(numerator, BigInt(wholePercent) * BigInt(wholePercent)))
  }
  const tax1 = tax('tax1', rates.tax1Percent ?? 0)
  const tax2 = tax('tax2', rates.tax2Percent ?? 0)
  return { lineAmounts, subtotal, discount, tax1, tax2, total: sumIntegers([subtotal, -discount, tax1, tax2]) }
}

/** What is left to pay: total − payments + refunds. */
export function amountDue(total: number, payments: readonly number[], refunds: readonly number[] = []): number {
  assertInteger(total, 'Total')
  for (const amount of [...payments, ...refunds]) assertNotNegative(amount, 'Payment')
  return sumIntegers([total, ...payments.map((amount) => -amount), ...refunds])
}
