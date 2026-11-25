/** Dates of recurring invoices, and how late clients are. */
import { addDays, addMonths, daysBetween, type IsoDate } from '../dates'
import { sumIntegers } from './integers'

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

const months = { monthly: 1, quarterly: 3, yearly: 12 } as const

/** The date of an occurrence, counted from 0. Each is made from the start, so that the 31st stays the last of a month. */
export function occurrence(startsOn: IsoDate, frequency: RecurringFrequency, interval: number, index: number): IsoDate {
  const steps = interval * index
  return frequency === 'weekly' ? addDays(startsOn, 7 * steps) : addMonths(startsOn, months[frequency] * steps)
}

/** The first date after the given one. */
export function nextOccurrence(startsOn: IsoDate, frequency: RecurringFrequency, interval: number, after: IsoDate): IsoDate {
  let index = 0
  while (occurrence(startsOn, frequency, interval, index) <= after) index++
  return occurrence(startsOn, frequency, interval, index)
}

const limits = [0, 30, 60, 90]

/** What is due by how late it is: not yet late, up to 30, 60 and 90 days, and later. */
export function ageing(open: readonly { dueOn: IsoDate; dueAmount: number }[], today: IsoDate): number[] {
  const buckets: number[][] = [[], [], [], [], []]
  for (const { dueOn, dueAmount } of open) {
    const late = daysBetween(dueOn, today)
    const index = limits.findIndex((limit) => late <= limit)
    buckets[index === -1 ? limits.length : index]?.push(dueAmount)
  }
  return buckets.map((amounts) => sumIntegers(amounts))
}

/** The days a reminder is due on that are over, the latest last. */
export const remindersDue = (dueOn: IsoDate, days: readonly number[], today: IsoDate): IsoDate[] =>
  [...days].sort((a, b) => a - b).map((day) => addDays(dueOn, day)).filter((date) => date <= today)
