import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addDays, addMonths, formatDate, formatLongDate, isIsoDate, matchPreset, monthGrid, parseDate, presetRange, type RangePresetId, startOfWeek, todayOnDevice,
} from './dates'

describe('parseDate', () => {
  it.each([
    ['2026-11-23', '2026-11-23'],
    ['11/23/2026', '2026-11-23'],
    ['3/8/2026', '2026-03-08'],
    ['03/08/2026', '2026-03-08'],
    [' 2026-3-8 ', '2026-03-08'],
    ['Nov 23, 2026', '2026-11-23'],
    ['november 23 2026', '2026-11-23'],
    ['2028-02-29', '2028-02-29'],
    ['2/29/2028', '2028-02-29'],
  ])('reads %s', (text, expected) => expect(parseDate(text)).toBe(expected))

  it.each(['2/29/2027', '2027-02-29', '13/1/2026', '0/1/2026', '1/32/2026', '4/31/2026', '1/1/26', '23.11.2026', 'today', '', '2026-11', 'Foo 1, 2026', '0026-01-01'])(
    'refuses %s',
    (text) => expect(parseDate(text)).toBeNull(),
  )
})

it('knows which strings are dates', () => {
  expect(isIsoDate('2026-11-23')).toBe(true)
  for (const text of ['2026-11-31', '2026-1-1', '', '2026-11-23T00:00']) expect(isIsoDate(text)).toBe(false)
})

it('shows dates the same in any browser', () => {
  expect(formatDate('2026-11-23')).toBe('Nov 23, 2026')
  expect(formatDate('2026-03-08')).toBe('Mar 8, 2026')
  expect(formatLongDate('2026-11-23')).toBe('Monday, November 23, 2026')
})

describe('arithmetic', () => {
  it('moves by months, to the last day where there is no such day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })

  it('moves by days over the ends of months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('finds the start of the week', () => {
    expect(startOfWeek('2026-11-23', 1)).toBe('2026-11-23')
    expect(startOfWeek('2026-11-23', 0)).toBe('2026-11-22')
    expect(startOfWeek('2026-11-22', 1)).toBe('2026-11-16')
  })

  it('lays out a month', () => {
    const weeks = monthGrid(2026, 11, 1)
    expect(weeks).toHaveLength(6)
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01'])
    expect(weeks.flat().filter(Boolean)).toHaveLength(30)
    expect(monthGrid(2026, 11, 0)[0]?.[0]).toBe('2026-11-01')
  })
})

describe('presets with today 2026-11-23, a Monday', () => {
  it.each<[RangePresetId, 0 | 1, string, string]>([
    ['this-week', 1, '2026-11-23', '2026-11-29'],
    ['this-week', 0, '2026-11-22', '2026-11-28'],
    ['last-week', 1, '2026-11-16', '2026-11-22'],
    ['last-week', 0, '2026-11-15', '2026-11-21'],
    ['this-month', 1, '2026-11-01', '2026-11-30'],
    ['last-month', 1, '2026-10-01', '2026-10-31'],
    ['this-quarter', 1, '2026-10-01', '2026-12-31'],
    ['this-year', 1, '2026-01-01', '2026-12-31'],
  ])('%s, week start %i', (preset, weekStart, start, end) => {
    expect(presetRange(preset, '2026-11-23', weekStart)).toEqual({ start, end })
    expect(matchPreset({ start, end }, '2026-11-23', weekStart)).toBe(preset)
  })

  it('goes over the year end', () => {
    expect(presetRange('last-month', '2026-01-10', 1)).toEqual({ start: '2025-12-01', end: '2025-12-31' })
    expect(presetRange('this-quarter', '2026-03-31', 1)).toEqual({ start: '2026-01-01', end: '2026-03-31' })
  })

  it('matches nothing else', () => {
    expect(matchPreset({ start: '2026-11-02', end: '2026-11-03' }, '2026-11-23', 1)).toBeNull()
  })
})

describe('today', () => {
  const zone = process.env.TZ
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
    vi.useRealTimers()
  })

  it.each([
    ['America/Los_Angeles', '2026-11-22'],
    ['Pacific/Auckland', '2026-11-23'],
  ])('is the date on the device in %s', (timeZone, expected) => {
    process.env.TZ = timeZone
    vi.useFakeTimers({ now: new Date('2026-11-23T05:00:00Z') })
    expect(todayOnDevice()).toBe(expected)
  })
})
