import { type IsoDate, isIsoDate } from '../dates'
import type { ProjectType, RateMethod } from '../domain'
import { assertNotNegative, CalculationError } from './integers'

/** A person's rate from a date on, in minor units per hour of the company currency. */
export interface DatedRate {
  startsOn: IsoDate
  rate: number
}

export interface RateProject {
  type: ProjectType
  rateMethod: RateMethod
  /** Hourly rate of the project, in the client's currency. */
  rate: number | null
  /** Currency of the project's client. */
  currency: string
}

export interface BillableRateInput {
  /** The entry's date. */
  date: IsoDate
  /** Whether the entry itself is billable. */
  billable: boolean
  project: RateProject
  /** `projectRate` is the project-task rate; `defaultRate` the task's own, in company currency. */
  task: { projectRate: number | null; defaultRate: number | null }
  /** `projectRate` is the project-member rate; `rates` the person's own, in company currency. */
  person: { projectRate: number | null; rates: readonly DatedRate[] }
  companyCurrency: string
}

export type BillableRate =
  | { kind: 'rate'; rate: number }
  | { kind: 'not_billable' }
  /** Covered by the project's fixed fee. */
  | { kind: 'fixed_fee' }
  /** The project deliberately has no hourly rate. */
  | { kind: 'no_hourly_rate' }
  /** The project bills by the hour, but no rate applies. */
  | { kind: 'missing' }

export function resolveBillableRate(input: BillableRateInput): BillableRate {
  const { date, billable, project, task, person, companyCurrency } = input
  if (!isIsoDate(date)) throw new CalculationError(`Not a date: ${date}.`)
  if (!billable || project.type === 'non_billable') return { kind: 'not_billable' }
  if (project.type === 'fixed_fee') return { kind: 'fixed_fee' }
  // Company-wide defaults mean nothing in another currency.
  const defaultsApply = project.currency === companyCurrency
  switch (project.rateMethod) {
    case 'none':
      return { kind: 'no_hourly_rate' }
    case 'project':
      return found(project.rate)
    case 'task':
      return found(task.projectRate ?? (defaultsApply ? task.defaultRate : null))
    case 'person':
      return found(person.projectRate ?? (defaultsApply ? rateOn(person.rates, date) : null))
  }
}

/** The person's cost rate on a date, in company currency. */
export function resolveCostRate(rates: readonly DatedRate[], date: IsoDate): BillableRate & { kind: 'rate' | 'missing' } {
  return found(rateOn(rates, date))
}

/** The rate that started last on or before the date, or null. */
export function rateOn(rates: readonly DatedRate[], date: IsoDate): number | null {
  if (!isIsoDate(date)) throw new CalculationError(`Not a date: ${date}.`)
  let current: DatedRate | undefined
  for (const rate of rates) {
    if (!isIsoDate(rate.startsOn)) throw new CalculationError(`Not a date: ${rate.startsOn}.`)
    if (rate.startsOn <= date && (!current || rate.startsOn > current.startsOn)) current = rate
  }
  return current?.rate ?? null
}

/** 0 is a rate: the work is charged at nothing, which is different from having no rate. */
function found(rate: number | null): { kind: 'rate'; rate: number } | { kind: 'missing' } {
  if (rate === null) return { kind: 'missing' }
  assertNotNegative(rate, 'Rate')
  return { kind: 'rate', rate }
}
