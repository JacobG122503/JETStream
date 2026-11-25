/**
 * Billable and cost figures, which not everyone who sees a record may see. Every answer with such
 * figures goes through `visibleFields`, and every sort, filter or total by one through `moneyValue`.
 */
import { type AnyColumn, type SQL, sql } from 'drizzle-orm'
import type { PermissionKey } from '../../shared/permissions'
import type { Db, Tx } from '../db'
import { ApiError } from '../errors'
import type { Actor } from './actor'
import { can, holds, type RecordFacts, type RecordType } from './decisions'
import { filterFor } from './filters'

const billable = [
  'rate', 'rates', 'billableRate', 'billableRates', 'defaultRate', 'projectRate', 'amount', 'billableAmount', 'unbilledAmount',
  'invoicedAmount', 'fixedFee', 'feeBudget', 'budgetAmount',
]
const cost = ['costRate', 'costRates', 'cost', 'costAmount', 'margin', 'marginPercent', 'profit']

/** Named like a figure, but none. */
const harmless = ['rateMethod']

const viewPermission = new Map<string, PermissionKey>([
  ...billable.map((name) => [name, 'billable.view'] as const),
  ...cost.map((name) => [name, 'cost.view'] as const),
])

/** What people paid themselves, and what a client is asked to pay, is seen by whoever sees the record. */
const ownFigures: Partial<Record<RecordType, readonly string[]>> = {
  expense: ['amount', 'unitPrice'],
  receipt: ['amount', 'unitPrice'],
}

const figureWords = new Set(['rate', 'rates', 'amount', 'amounts', 'cost', 'costs', 'margin', 'fee', 'fees', 'price', 'profit'])
const looksLikeFigure = (name: string) => name.split(/(?=[A-Z])|_/).some((word) => figureWords.has(word.toLowerCase()))

/** The permission it takes to see a field, or null for one that everyone who sees the record sees. */
function neededFor(type: RecordType, name: string): PermissionKey | null {
  if (ownFigures[type]?.includes(name) || harmless.includes(name)) return null
  const needed = viewPermission.get(name)
  if (needed) return needed
  // Not let through by mistake: whoever adds a figure says here what it is.
  if (looksLikeFigure(name)) throw new Error(`The field ${name} looks like a billable or cost figure, but src/server/access/fields.ts does not know it`)
  return null
}

/**
 * The value without the billable and cost fields that the actor may not see on this record. Also in
 * the parts of it, such as the tasks and members of a project.
 */
export function visibleFields<T extends object>(actor: Actor, record: RecordFacts, value: T): Partial<T> {
  return strip(value, (name) => {
    const needed = neededFor(record.type, name)
    return needed === null || can(actor, needed, record)
  }) as Partial<T>
}

function strip(value: unknown, isVisible: (name: string) => boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => strip(item, isVisible))
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, part]) => (isVisible(name) ? [[name, strip(part, isVisible)]] : [])),
  )
}

/**
 * A figure for sorting, filtering or adding up in a list of the record type: null on the rows where
 * the actor may not see it. Refused when they may see it on none.
 */
export function moneyValue(db: Db | Tx, actor: Actor, type: RecordType, field: string, column: AnyColumn | SQL): SQL {
  const needed = viewPermission.get(field)
  if (!needed || !holds(actor, needed)) throw new ApiError(400, 'bad_request', 'The list cannot be sorted or filtered by this.')
  return sql`case when ${filterFor(db, actor, needed, type)} then ${column} end`
}
