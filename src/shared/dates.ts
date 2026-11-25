/**
 * Calendar dates as local ISO strings (YYYY-MM-DD). All arithmetic is on the calendar, through
 * UTC, so time zones and clock changes cannot move a date.
 */
export type IsoDate = string

/** 0 is Sunday, 1 Monday, as in Date. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface DateParts {
  year: number
  /** 1 to 12. */
  month: number
  day: number
}

const pad = (value: number, length: number) => String(value).padStart(length, '0')

export function toIso({ year, month, day }: DateParts): IsoDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

export function partsOf(date: IsoDate): DateParts {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return { year, month, day }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function isRealDate({ year, month, day }: DateParts): boolean {
  // Two-digit years are ambiguous, and JavaScript reads them as 19xx.
  return year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

export function isIsoDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && isRealDate(partsOf(text))
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

/** ISO strings sort by date. */
export function clampDate(date: IsoDate, min?: IsoDate, max?: IsoDate): IsoDate {
  if (min && date < min) return min
  if (max && date > max) return max
  return date
}

/** Whole days from one date to another; below 0 when the other is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const at = (date: IsoDate) => {
    const { year, month, day } = partsOf(date)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((at(to) - at(from)) / dayMs)
}
