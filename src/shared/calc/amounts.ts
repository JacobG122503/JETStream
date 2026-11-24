import { roundingIncrements, type RoundingIncrement, type RoundingMode } from '../domain'
import {
  assertInteger, assertNotNegative, CalculationError, minutesPerHour, multiplyDivide, thousand,
} from './integers'

/** Minutes at an hourly rate in minor units: minutes × rate ÷ 60, rounded once. */
export function timeAmount(minutes: number, hourlyRate: number): number {
  assertNotNegative(minutes, 'Minutes')
  assertInteger(hourlyRate, 'Hourly rate')
  return multiplyDivide(minutes, hourlyRate, minutesPerHour)
}

export interface TimeRounding {
  mode: RoundingMode
  increment: RoundingIncrement
}

/**
 * An entry's minutes as reported and billed. Applied to each entry before adding up; the stored
 * minutes never change.
 */
export function roundMinutes(minutes: number, { mode, increment }: TimeRounding): number {
  assertNotNegative(minutes, 'Minutes')
  if (mode === 'off') return minutes
  if (!roundingIncrements.includes(increment)) {
    throw new CalculationError(`Time cannot be rounded to ${String(increment)} minutes.`)
  }
  const past = minutes % increment
  const down = minutes - past
  switch (mode) {
    case 'down':
      return down
    case 'up':
      return past === 0 ? minutes : down + increment
    case 'nearest':
      return past * 2 >= increment ? down + increment : down
    default:
      throw new CalculationError(`Unknown time rounding: ${String(mode)}.`)
  }
}

/** Quantity in thousandths × unit price in thousandths of a minor unit, rounded once. */
export function expenseAmount(quantity: number, unitPrice: number): number {
  assertInteger(quantity, 'Quantity')
  assertInteger(unitPrice, 'Unit price')
  return multiplyDivide(quantity, unitPrice, thousand * thousand)
}

/** Minutes as hours in thousandths, to show next to an hourly rate. Not used to calculate money. */
export function hoursQuantity(minutes: number): number {
  assertNotNegative(minutes, 'Minutes')
  return multiplyDivide(minutes, thousand, minutesPerHour)
}
