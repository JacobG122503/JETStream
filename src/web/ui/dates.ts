/**
 * Calendar dates as local ISO strings (YYYY-MM-DD). All arithmetic is on the calendar, through
 * UTC, so time zones and clock changes cannot move a date.
 */
export type IsoDate = string

/** 0 is Sunday, 1 Monday, as in Date. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
] as const
export const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

interface Parts {
  year: number
  /** 1 to 12. */
  month: number
  day: number
}

const pad = (value: number, length: number) => String(value).padStart(length, '0')

export function toIso({ year, month, day }: Parts): IsoDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

export function partsOf(date: IsoDate): Parts {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return { year, month, day }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function isRealDate({ year, month, day }: Parts): boolean {
  // Two-digit years are ambiguous, and JavaScript reads them as 19xx.
  return year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

export function isIsoDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && isRealDate(partsOf(text))
}

/** Reads YYYY-MM-DD, M/D/YYYY and the display form. Null when it is not a real date. */
export function parseDate(text: string): IsoDate | null {
  const trimmed = text.trim()
  let parts: Parts | undefined
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed)
  const shown = /^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i.exec(trimmed)
  if (iso) parts = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
  else if (us) parts = { year: Number(us[3]), month: Number(us[1]), day: Number(us[2]) }
  else if (shown) {
    const name = (shown[1] ?? '').toLowerCase()
    const month = monthNames.findIndex((full) => full.toLowerCase().startsWith(name)) + 1
    parts = { year: Number(shown[3]), month, day: Number(shown[2]) }
  }
  return parts && isRealDate(parts) ? toIso(parts) : null
}

/** "Nov 23, 2026", whatever the browser's language. */
export function formatDate(date: IsoDate): string {
  const { year, month, day } = partsOf(date)
  return `${monthNames[month - 1]?.slice(0, 3)} ${day}, ${year}`
}

/** "Monday, November 23, 2026" */
export function formatLongDate(date: IsoDate): string {
  const { year, month, day } = partsOf(date)
  return `${weekdayNames[weekdayOf(date)]}, ${monthNames[month - 1]} ${day}, ${year}`
}

const dayMs = 86_400_000

export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = partsOf(date)
  const moved = new Date(Date.UTC(year, month - 1, day) + days * dayMs)
  return toIso({ year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() })
}

/** The same day in another month, or that month's last day. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = partsOf(date)
  const index = year * 12 + (month - 1) + months
  const newYear = Math.floor(index / 12)
  const newMonth = index - newYear * 12 + 1
  return toIso({ year: newYear, month: newMonth, day: Math.min(day, daysInMonth(newYear, newMonth)) })
}

export function weekdayOf(date: IsoDate): Weekday {
  const { year, month, day } = partsOf(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as Weekday
}

export function startOfWeek(date: IsoDate, weekStart: Weekday): IsoDate {
  return addDays(date, -((weekdayOf(date) - weekStart + 7) % 7))
}

/** The date on this device's clock. */
export function todayOnDevice(): IsoDate {
  const now = new Date()
  return toIso({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() })
}

/** ISO strings sort by date. */
export function clampDate(date: IsoDate, min?: IsoDate, max?: IsoDate): IsoDate {
  if (min && date < min) return min
  if (max && date > max) return max
  return date
}

/** Weeks of a month, each with seven places; null outside the month. */
export function monthGrid(year: number, month: number, weekStart: Weekday): (IsoDate | null)[][] {
  const first = toIso({ year, month, day: 1 })
  const last = toIso({ year, month, day: daysInMonth(year, month) })
  const weeks: (IsoDate | null)[][] = []
  for (let start = startOfWeek(first, weekStart); start <= last; start = addDays(start, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, offset) => {
        const date = addDays(start, offset)
        return date >= first && date <= last ? date : null
      }),
    )
  }
  return weeks
}

export interface DateRange {
  start: IsoDate
  end: IsoDate
}

export const rangePresets = [
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'this-quarter', label: 'This quarter' },
  { id: 'this-year', label: 'This year' },
] as const

export type RangePresetId = (typeof rangePresets)[number]['id']

export function presetRange(preset: RangePresetId, today: IsoDate, weekStart: Weekday): DateRange {
  const { year, month } = partsOf(today)
  const months = (firstMonth: IsoDate, count: number): DateRange => ({
    start: firstMonth,
    end: addDays(addMonths(firstMonth, count), -1),
  })
  const week = startOfWeek(today, weekStart)
  const thisMonth = toIso({ year, month, day: 1 })
  switch (preset) {
    case 'this-week':
      return { start: week, end: addDays(week, 6) }
    case 'last-week':
      return { start: addDays(week, -7), end: addDays(week, -1) }
    case 'this-month':
      return months(thisMonth, 1)
    case 'last-month':
      return months(addMonths(thisMonth, -1), 1)
    case 'this-quarter':
      return months(toIso({ year, month: month - ((month - 1) % 3), day: 1 }), 3)
    case 'this-year':
      return months(toIso({ year, month: 1, day: 1 }), 12)
  }
}

export function matchPreset(range: DateRange, today: IsoDate, weekStart: Weekday): RangePresetId | null {
  const found = rangePresets.find(({ id }) => {
    const preset = presetRange(id, today, weekStart)
    return preset.start === range.start && preset.end === range.end
  })
  return found?.id ?? null
}
