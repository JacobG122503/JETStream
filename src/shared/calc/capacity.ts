import { type IsoDate, daysBetween } from '../dates'
import { divideRounded, toSafeNumber } from './integers'

/** The working time of a period, in minutes: seven days are a week. */
export const periodCapacity = (weeklyMinutes: number, from: IsoDate, to: IsoDate): number =>
  toSafeNumber(divideRounded(BigInt(weeklyMinutes) * BigInt(daysBetween(from, to) + 1), 7n))
