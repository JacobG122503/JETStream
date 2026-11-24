/** Collects demo records in memory, with the same keys and choices every time. */
import type { PgTable } from 'drizzle-orm/pg-core'
import { addDays, type IsoDate, startOfWeek, weekdayOf } from '../../shared/dates'
import { instantAt } from '../clock'

export interface DemoDates {
  today: IsoDate
  /** Monday of the current week. */
  thisWeek: IsoDate
  /** The start of today: nothing in the demo happened later. */
  now: Date
  timeZone: string
  daysFromToday: (days: number) => IsoDate
  /** A date counted from the current week's Monday. */
  week: (weeks: number, days?: number) => IsoDate
  /** A moment in local time, but not later than `now`. */
  past: (date: IsoDate, hour: number, minute?: number) => Date
}

export function demoDates(today: IsoDate, timeZone: string): DemoDates {
  const thisWeek = startOfWeek(today, 1)
  const now = instantAt(today, 0, timeZone)
  return {
    today,
    thisWeek,
    now,
    timeZone,
    daysFromToday: (days) => addDays(today, days),
    week: (weeks, days = 0) => addDays(thisWeek, weeks * 7 + days),
    past: (date, hour, minute = 0) => {
      const at = instantAt(date, hour * 60 + minute, timeZone)
      return at < now ? at : now
    },
  }
}

export const isWeekday = (date: IsoDate) => weekdayOf(date) >= 1 && weekdayOf(date) <= 5

export function datesBetween(first: IsoDate, last: IsoDate): IsoDate[] {
  const dates: IsoDate[] = []
  for (let date = first; date <= last; date = addDays(date, 1)) dates.push(date)
  return dates
}

/** Random choices that are the same every time. */
export class Choices {
  constructor(private state: number) {}

  /** From 0 up to, but not including, 1 (mulberry32). */
  private next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let mixed = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }

  /** A whole number, both ends included. */
  between(low: number, high: number): number {
    return low + Math.floor(this.next() * (high - low + 1))
  }

  chance(percent: number): boolean {
    return this.next() * 100 < percent
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.between(0, items.length - 1)]
    if (item === undefined) throw new Error('Nothing to choose from')
    return item
  }

  /** Items with a higher weight are chosen more often. */
  pickWeighted<T extends { weight: number }>(items: readonly T[]): T {
    let left = this.between(1, items.reduce((sum, { weight }) => sum + weight, 0))
    for (const item of items) {
      left -= item.weight
      if (left <= 0) return item
    }
    return this.pick(items)
  }
}

type Row = Record<string, unknown>

/** Rows to insert, in the order in which their tables were first used. */
export class DemoRows {
  readonly tables = new Map<PgTable, Row[]>()

  constructor(private now: Date) {}

  /**
   * Adds a row and returns its id, counted from 1 (meaningless for tables without one). The row
   * can still be changed afterwards.
   */
  add<T extends PgTable>(table: T, row: T['$inferInsert']): number {
    let rows = this.tables.get(table)
    if (!rows) {
      rows = []
      this.tables.set(table, rows)
    }
    const id = rows.length + 1
    const added: Row = row
    if ('id' in table) added.id = id
    if ('createdAt' in table) added.createdAt ??= this.now
    if ('updatedAt' in table) added.updatedAt ??= added.createdAt ?? this.now
    rows.push(added)
    return id
  }
}
