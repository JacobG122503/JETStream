// @vitest-environment node
import { expect, it } from 'vitest'
import { formatAmounts, formatClock, formatHours, formatMoney, parseHours, parseMoney, percentOf } from './format'

it.each([
  ['1:30', 90], ['1.5', 90], ['1,5', 90], ['.25', 15], [':45', 45], ['0:05', 5], ['90m', 90], ['1h 30m', 90], ['1.5h', 90], ['2h', 120], ['8', 480],
  ['', null], ['abc', null], ['1:75', null], ['-1', null], ['1h30', null],
])('reads the time "%s"', (text, minutes) => expect(parseHours(text)).toBe(minutes))

it.each([
  ['1,284.50', 'USD', 128_450], ['$12', 'USD', 1200], ['0.5', 'USD', 50], ['1200', 'JPY', 1200], ['1.5', 'JPY', null], ['1.234', 'USD', null], ['', 'USD', null],
  ['-5', 'USD', null], ['12e3', 'USD', null],
])('reads the amount "%s" in %s', (text, currency, amount) => expect(parseMoney(text, currency)).toBe(amount))

it('writes hours, clocks and money', () => {
  expect([0, 5, 90, 2285].map(formatHours)).toEqual(['0:00', '0:05', '1:30', '38:05'])
  expect([0, 59, 3729].map(formatClock)).toEqual(['0:00:00', '0:00:59', '1:02:09'])
  expect(formatMoney(128_450, 'USD')).toBe('$1,284.50')
  expect(formatMoney(128_450, 'USD', { whole: true })).toBe('$1,285')
  expect(formatMoney(1200, 'JPY')).toBe('¥1,200')
  expect(formatAmounts([{ currency: 'EUR', amount: 100 }, { currency: 'USD', amount: 200 }])).toBe('€1.00 + $2.00')
  expect(formatAmounts([])).toBe('$0.00')
  expect([percentOf(1, 3), percentOf(1, 0)]).toEqual([33, 0])
})
