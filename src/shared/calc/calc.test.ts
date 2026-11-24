import { describe, expect, it } from 'vitest'
import type { RoundingMode } from '../domain'
import { currencyExponent } from '../currency'
import {
  amountDue, type BillableRateInput, divideRounded, type DocumentLine, documentTotals, expenseAmount, hoursQuantity,
  resolveBillableRate, resolveCostRate, roundMinutes, sumIntegers, timeAmount,
} from '.'

const max = Number.MAX_SAFE_INTEGER

describe('exact division', () => {
  it.each([
    [5n, 2n, 3n],
    [-5n, 2n, -3n],
    [4n, 3n, 1n],
    [-4n, 3n, -1n],
    [5n, 3n, 2n],
    [0n, 7n, 0n],
  ])('%s / %s rounds half away from zero to %s', (numerator, denominator, result) => {
    expect(divideRounded(numerator, denominator)).toBe(result)
  })
})

describe('time amounts', () => {
  it.each([
    [100, 12550, 20917],
    [20, 10000, 3333],
    [60, 10000, 10000],
    [30, 1, 1],
    [29, 1, 0],
    [0, 12550, 0],
    [1440, 0, 0],
    // 2^53 - 1 at one hour: floating point would be off.
    [60, max, max],
    [61, 8_859_023_016_387_860, 9_006_673_399_994_324],
  ])('%i minutes at %i an hour is %i', (minutes, rate, amount) => {
    expect(timeAmount(minutes, rate)).toBe(amount)
  })

  it.each([
    ['half a minute', 0.5, 100],
    ['negative minutes', -1, 100],
    ['a fractional rate', 1, 0.1],
    ['NaN', NaN, 100],
    ['Infinity', 1, Infinity],
    ['an unsafe result', 120, max],
    ['an unsafe rate', 1, max + 1],
  ])('refuses %s', (_name, minutes, rate) => {
    expect(() => timeAmount(minutes, rate)).toThrow()
  })

  it('shows minutes as hours', () => {
    expect([90, 60, 20, 100].map(hoursQuantity)).toEqual([1500, 1000, 333, 1667])
  })
})

describe('time rounding', () => {
  it.each<[number, RoundingMode, 5 | 6 | 10 | 15 | 30, number]>([
    [7, 'up', 15, 15],
    [7, 'nearest', 15, 0],
    [7, 'down', 15, 0],
    [8, 'nearest', 15, 15],
    [3, 'nearest', 6, 6],
    [2, 'nearest', 6, 0],
    [5, 'nearest', 10, 10],
    [15, 'nearest', 30, 30],
    [15, 'up', 15, 15],
    [15, 'down', 15, 15],
    [16, 'up', 15, 30],
    [1439, 'up', 30, 1440],
    [62, 'nearest', 5, 60],
    [7, 'off', 15, 7],
  ])('%i minutes %s to %i is %i', (minutes, mode, increment, result) => {
    expect(roundMinutes(minutes, { mode, increment })).toBe(result)
  })

  it.each(['off', 'up', 'nearest', 'down'] as const)('keeps 0 with %s', (mode) => {
    expect(roundMinutes(0, { mode, increment: 15 })).toBe(0)
  })

  it('refuses other increments, modes and minutes', () => {
    expect(() => roundMinutes(5, { mode: 'up', increment: 7 as 5 })).toThrow()
    expect(() => roundMinutes(5, { mode: 'sideways' as 'up', increment: 5 })).toThrow()
    expect(() => roundMinutes(-5, { mode: 'off', increment: 5 })).toThrow()
    expect(() => roundMinutes(1.5, { mode: 'off', increment: 5 })).toThrow()
  })
})

describe('expense amounts', () => {
  it('multiplies quantity and unit price and rounds once', () => {
    expect(expenseAmount(123_400, 65_500)).toBe(8083) // 123.4 miles at 65.5 cents
    expect(expenseAmount(1000, 1000)).toBe(1)
    expect(expenseAmount(500, 1000)).toBe(1)
    expect(expenseAmount(499, 1000)).toBe(0)
    expect(expenseAmount(-500, 1000)).toBe(-1)
  })

  it('refuses fractions and unsafe results', () => {
    expect(() => expenseAmount(1.5, 1000)).toThrow()
    expect(() => expenseAmount(max, max)).toThrow()
  })
})

describe('document totals', () => {
  const line = (quantity: number, unitPrice: number, tax1 = false, tax2 = false): DocumentLine => ({
    quantity, unitPrice, tax1, tax2,
  })
  const none = { discountPercent: null, tax1Percent: null, tax2Percent: null }
  const lines = [line(10_000, 12_000, true), line(2500, 9500, true, true), line(1000, 4999)]
  const rates = { discountPercent: 10_000, tax1Percent: 8250, tax2Percent: 5000 }

  it('applies the discount, then each tax to its taxable lines', () => {
    expect(documentTotals(lines, rates)).toEqual({
      lineAmounts: [120_000, 23_750, 4999],
      subtotal: 148_749,
      discount: 14_875,
      tax1: 10_673,
      tax2: 1069,
      total: 145_616,
    })
    expect(amountDue(145_616, [100_000])).toBe(45_616)
    expect(amountDue(145_616, [100_000, 45_616], [5000])).toBe(5000)
  })

  it('takes the amount of a line of time from its minutes', () => {
    const time = { ...line(333, 10_000), minutes: 60 }
    expect(documentTotals([time], none).lineAmounts).toEqual([10_000])
    // Three entries of 20 minutes: 10000 on one line, not three times 3333.
    expect(documentTotals([{ ...line(0, 10_000), minutes: 20 * 3 }], none).total).toBe(10_000)
    expect(documentTotals([{ ...line(1000, 10_000), minutes: 0 }], none).total).toBe(0)
  })

  it('allows negative lines, and rounds them away from zero', () => {
    expect(documentTotals([line(-500, 1)], none).lineAmounts).toEqual([-1])
    expect(documentTotals([line(-1000, 5000), line(1000, 2000)], none).total).toBe(-3000)
    expect(documentTotals([line(1000, -10_000, true)], rates).tax1).toBe(-743) // -742.5
  })

  it('is zero without lines, and never minus zero', () => {
    expect(documentTotals([], rates).total).toBe(0)
    expect(Object.is(documentTotals([line(-1, 1, true, true)], rates).total, 0)).toBe(true)
    expect(Object.is(documentTotals([line(0, 1)], rates).discount, 0)).toBe(true)
  })

  it('takes everything off at 100%', () => {
    expect(documentTotals(lines, { ...rates, discountPercent: 100_000 })).toMatchObject({ total: 0, tax1: 0 })
  })

  it.each([
    ['a discount over 100%', lines, { ...rates, discountPercent: 100_001 }],
    ['a negative tax', lines, { ...rates, tax1Percent: -1 }],
    ['a tax over 100%', lines, { ...rates, tax2Percent: 100_001 }],
    ['a fractional tax', lines, { ...rates, tax1Percent: 8.25 }],
    ['a fractional quantity', [line(0.5, 1)], rates],
    ['negative minutes', [{ ...line(1, 1), minutes: -1 }], rates],
    ['an unsafe line', [line(1_000_000, max)], rates],
    ['an unsafe sum', [line(1000, max), line(1000, 1)], rates],
  ])('refuses %s', (_name, bad, badRates) => {
    expect(() => documentTotals(bad, badRates)).toThrow()
  })

  it('refuses sums that are not exact', () => {
    expect(sumIntegers([max, -max, 5])).toBe(5)
    expect(() => sumIntegers([max, 1])).toThrow()
    expect(() => sumIntegers([0.1])).toThrow()
    expect(() => amountDue(0.5, [])).toThrow()
    expect(() => amountDue(5, [-1])).toThrow()
  })
})

describe('billable rates', () => {
  const input = (change: {
    [K in keyof BillableRateInput]?: BillableRateInput[K] extends object
      ? Partial<BillableRateInput[K]>
      : BillableRateInput[K]
  }): BillableRateInput => ({
    date: '2026-06-30',
    billable: true,
    companyCurrency: 'USD',
    ...(change.date !== undefined && { date: change.date }),
    ...(change.billable !== undefined && { billable: change.billable }),
    project: { type: 'time_materials', rateMethod: 'person', rate: null, currency: 'USD', ...change.project },
    task: { projectRate: null, defaultRate: null, ...change.task },
    person: { projectRate: null, rates: [], ...change.person },
  })
  const dated = [
    { startsOn: '2026-07-01', rate: 12_000 },
    { startsOn: '2026-01-01', rate: 10_000 },
  ]
  const rate = (value: number) => ({ kind: 'rate', rate: value })

  it.each([
    ['2026-06-30', rate(10_000)],
    ['2026-07-01', rate(12_000)],
    ['2025-12-31', { kind: 'missing' }],
  ])("uses the person's rate on %s", (date, expected) => {
    expect(resolveBillableRate(input({ date, person: { rates: dated } }))).toEqual(expected)
  })

  it('prefers the rate on the project, also when it is 0', () => {
    expect(resolveBillableRate(input({ person: { projectRate: 15_000, rates: dated } }))).toEqual(rate(15_000))
    expect(resolveBillableRate(input({ person: { projectRate: 0, rates: dated } }))).toEqual(rate(0))
    const task = { projectRate: 0, defaultRate: 9000 }
    expect(resolveBillableRate(input({ project: { rateMethod: 'task' }, task }))).toEqual(rate(0))
  })

  it('uses the project or the task by rate method', () => {
    expect(resolveBillableRate(input({ project: { rateMethod: 'project', rate: 8000 } }))).toEqual(rate(8000))
    expect(resolveBillableRate(input({ project: { rateMethod: 'project' } }))).toEqual({ kind: 'missing' })
    const project = { rateMethod: 'task' as const }
    expect(resolveBillableRate(input({ project, task: { projectRate: 7000, defaultRate: 1 } }))).toEqual(rate(7000))
    expect(resolveBillableRate(input({ project, task: { defaultRate: 6000 } }))).toEqual(rate(6000))
    expect(resolveBillableRate(input({ project }))).toEqual({ kind: 'missing' })
  })

  it('skips company-currency defaults for a client with another currency', () => {
    expect(resolveBillableRate(input({ project: { currency: 'EUR' }, person: { rates: dated } }))).toEqual({
      kind: 'missing',
    })
    const project = { currency: 'EUR', rateMethod: 'task' as const }
    expect(resolveBillableRate(input({ project, task: { defaultRate: 6000 } }))).toEqual({ kind: 'missing' })
    expect(resolveBillableRate(input({ project, task: { projectRate: 5000 } }))).toEqual(rate(5000))
    expect(resolveBillableRate(input({ project: { currency: 'EUR' }, person: { projectRate: 4000 } }))).toEqual(rate(4000))
  })

  it('knows work without an hourly rate', () => {
    const rates = { person: { rates: dated } }
    expect(resolveBillableRate(input({ ...rates, billable: false })).kind).toBe('not_billable')
    expect(resolveBillableRate(input({ ...rates, project: { type: 'non_billable' } })).kind).toBe('not_billable')
    expect(resolveBillableRate(input({ ...rates, project: { type: 'fixed_fee' } })).kind).toBe('fixed_fee')
    expect(resolveBillableRate(input({ billable: false, project: { type: 'fixed_fee' } })).kind).toBe('not_billable')
    expect(resolveBillableRate(input({ ...rates, project: { rateMethod: 'none' } })).kind).toBe('no_hourly_rate')
  })

  it('refuses dates that do not exist and negative rates', () => {
    expect(() => resolveBillableRate(input({ date: '2026-02-30' }))).toThrow()
    expect(() => resolveBillableRate(input({ person: { projectRate: -1 } }))).toThrow()
  })

  it('resolves the cost rate by date', () => {
    expect(resolveCostRate(dated, '2026-12-31')).toEqual(rate(12_000))
    expect(resolveCostRate(dated, '2026-01-01')).toEqual(rate(10_000))
    expect(resolveCostRate(dated, '2025-12-31')).toEqual({ kind: 'missing' })
  })
})

it('knows the decimals of currencies', () => {
  expect(['USD', 'JPY', 'KWD'].map(currencyExponent)).toEqual([2, 0, 3])
  expect(() => currencyExponent('usd')).toThrow()
})
