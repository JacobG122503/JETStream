// @vitest-environment node
import { expect, it } from 'vitest'
import { formatAmounts, formatClock, formatDay, formatHours, formatWeek, hoursInput, formatMoney, parseHours, parseMoney, percentOf } from './format'

it.each([
  ['1:30', 90], ['1.5', 90], ['1,5', 90], ['.25', 15], [':45', 45], ['0:05', 5], ['90m', 90], ['1h 30m', 90], ['1.5h', 90], ['2h', 120], ['8', 480],
  ['', null], ['abc', null], ['1:75', null], ['-1', null], ['1h30', null],
])('reads the time "%s"', (text, minutes) => expect(parseHours(text)).toBe(minutes))

it.each([
  ['1,284.50', 'USD', 128_450], ['$12', 'USD', 1200], ['0.5', 'USD', 50], ['1200', 'JPY', 1200], ['1.5', 'JPY', null], ['1.234', 'USD', null], ['', 'USD', null],
  ['-5', 'USD', null], ['12e3', 'USD', null],
])('reads the amount "%s" in %s', (text, currency, amount) => expect(parseMoney(text, currency)).toBe(amount))

it('writes hours, clocks and money', () => {
  expect([0, 5, 90, 375, 87_075].map(formatHours)).toEqual(['0.00', '0.08', '1.50', '6.25', '1,451.25'])
  expect(formatDay('2026-11-25')).toBe('Wednesday, 25 Nov')
  expect([formatWeek('2026-11-21', '2026-11-27'), formatWeek('2026-11-28', '2026-12-04')]).toEqual(['21 to 27 Nov 2026', '28 Nov to 4 Dec 2026'])
  // No minute is lost between showing and saving.
  for (let minutes = 0; minutes <= 1440; minutes++) expect(parseHours(hoursInput(minutes))).toBe(minutes)
  expect([0, 59, 3729].map(formatClock)).toEqual(['0:00:00', '0:00:59', '1:02:09'])
  expect(formatMoney(128_450, 'USD')).toBe('$1,284.50')
  expect(formatMoney(128_450, 'USD', { whole: true })).toBe('$1,285')
  expect(formatMoney(1200, 'JPY')).toBe('¥1,200')
  expect(formatAmounts([{ currency: 'EUR', amount: 100 }, { currency: 'USD', amount: 200 }])).toBe('€1.00 + $2.00')
  expect(formatAmounts([])).toBe('$0.00')
  expect([percentOf(1, 3), percentOf(1, 0)]).toEqual([33, 0])
})
