import { expect, it } from 'vitest'
import { instantAt, todayIn } from './clock'

it('knows the date in the company time zone', () => {
  const chicago = (moment: string) => todayIn('America/Chicago', new Date(moment))
  expect(chicago('2026-11-24T05:59:59Z')).toBe('2026-11-23')
  expect(chicago('2026-11-24T06:00:00Z')).toBe('2026-11-24')
  expect(chicago('2026-07-01T04:59:59Z')).toBe('2026-06-30')
  expect(chicago('2028-03-01T05:59:59Z')).toBe('2028-02-29')
})

it('finds the moment of a local time, also around clock changes', () => {
  const at = (date: string, minute: number) => instantAt(date, minute, 'America/Chicago').toISOString()
  expect(at('2026-11-23', 8 * 60)).toBe('2026-11-23T14:00:00.000Z')
  expect(at('2026-07-01', 0)).toBe('2026-07-01T05:00:00.000Z')
  expect(at('2026-03-08', 60)).toBe('2026-03-08T07:00:00.000Z')
  expect(at('2026-03-08', 4 * 60)).toBe('2026-03-08T09:00:00.000Z')
  expect(at('2026-11-01', 5)).toBe('2026-11-01T05:05:00.000Z')
  expect(at('2026-11-01', 12 * 60)).toBe('2026-11-01T18:00:00.000Z')
})
