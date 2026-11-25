/** What work earns and costs, and what contractors did. */
import { and, between, eq, inArray, or } from 'drizzle-orm'
import { type DatedRate, resolveCostRate, timeAmount } from '../../shared/calc'
import type { IsoDate } from '../../shared/dates'
import type { ContractorReport, ProfitReport, ProfitRow } from '../../shared/work'
import type { Actor } from '../access/actor'
import { can, ownId, requirePermission } from '../access/decisions'
import { filterFor } from '../access/filters'
import type { AppContext } from '../context'
import type { Db } from '../db'
import { expenses, people, personRates, timeEntries } from '../db/schema'
import { getSettings } from '../people/lookup'
import { byCurrency, groupRows, loadValued, sumBy, type Valued } from './figures'
import { checkPeriod } from './reports'

interface Period {
  from: IsoDate
  to: IsoDate
}

/** What an entry cost, in company currency; null without a cost rate. */
async function costOf(db: Db, rows: readonly Valued[]): Promise<(row: Valued) => number | null> {
  const ids = [...new Set(rows.map(({ personId }) => personId))]
  const stored = ids.length === 0 ? [] : await db.select().from(personRates).where(and(eq(personRates.kind, 'cost'), inArray(personRates.personId, ids)))
  const dated = new Map<number, DatedRate[]>()
  for (const { personId, startsOn, rate } of stored) dated.set(personId, [...(dated.get(personId) ?? []), { startsOn, rate }])
  return ({ personId, spentOn, worked }) => {
    const found = resolveCostRate(dated.get(personId) ?? [], spentOn)
    return found.kind === 'rate' ? timeAmount(worked, found.rate) : null
  }
}

/** Earnings less costs of the work the actor sees both of. */
export async function readProfitReport(ctx: AppContext, actor: Actor, { from, to, fixedFee }: Period & { fixedFee: boolean }): Promise<ProfitReport> {
  for (const key of ['cost.view', 'billable.view', 'time.view'] as const) requirePermission(actor, key)
  checkPeriod({ from, to })
  const { db } = ctx
  const { currency } = await getSettings(db)
  const rows = (await loadValued(db, and(filterFor(db, actor, 'time.view', 'timeEntry'), between(timeEntries.spentOn, from, to)), { fixedFee })).filter(
    ({ personId, projectId, projectType }) =>
      (fixedFee || projectType !== 'fixed_fee') && can(actor, 'billable.view', { type: 'project', projectId }) && can(actor, 'cost.view', { type: 'timeEntry', personId, projectId }),
  )
  const counted = rows.filter((row) => row.currency === currency)
  const cost = await costOf(db, counted)
  const group = (keyOf: (row: Valued) => number, describe: (row: Valued) => Pick<ProfitRow, 'name' | 'sub'>): ProfitRow[] =>
    [...groupRows(counted, keyOf)]
      .map(([id, part]) => ({
        id, ...describe(part[0] as Valued),
        minutes: sumBy(part, ({ worked }) => worked), revenue: sumBy(part, ({ amount }) => amount ?? 0), cost: sumBy(part, (row) => cost(row) ?? 0),
      }))
      .sort((a, b) => b.revenue - b.cost - (a.revenue - a.cost))
  return {
    currency,
    minutes: sumBy(counted, ({ worked }) => worked), revenue: sumBy(counted, ({ amount }) => amount ?? 0), cost: sumBy(counted, (row) => cost(row) ?? 0),
    byClient: group((row) => row.clientId, ({ client }) => ({ name: client })),
    byProject: group((row) => row.projectId, ({ project, client }) => ({ name: project, sub: client })),
    byTask: group((row) => row.taskId, ({ task }) => ({ name: task })),
    byPerson: group((row) => row.personId, ({ person }) => ({ name: person })),
    otherCurrencyMinutes: sumBy(rows.filter((row) => row.currency !== currency), ({ worked }) => worked),
    withoutCostMinutes: sumBy(counted.filter((row) => cost(row) === null), ({ worked }) => worked),
  }
}

/** The contractors with time or expenses in the period. */
export async function readContractorReport(ctx: AppContext, actor: Actor, { from, to }: Period): Promise<ContractorReport> {
  requirePermission(actor, 'time.view')
  checkPeriod({ from, to })
  const { db } = ctx
  const { currency } = await getSettings(db)
  const own = ownId(actor)
  const rows = await loadValued(db, and(or(eq(timeEntries.personId, own), filterFor(db, actor, 'time.view', 'timeEntry')), between(timeEntries.spentOn, from, to), eq(people.kind, 'contractor')))
  const spent = await db
    .select({ personId: expenses.personId, person: people.name, currency: expenses.currency, amount: expenses.amount })
    .from(expenses)
    .innerJoin(people, eq(people.id, expenses.personId))
    .where(and(or(eq(expenses.personId, own), filterFor(db, actor, 'time.view', 'expense')), between(expenses.spentOn, from, to), eq(people.kind, 'contractor')))
  const cost = await costOf(db, rows)
  const ids = [...new Set([...rows, ...spent].map(({ personId }) => personId))]
  const known = ids.length === 0 ? [] : await db.select({ id: people.id, name: people.name, photoId: people.photoFileId }).from(people).where(inArray(people.id, ids))
  const seesCost = (row: Valued) => can(actor, 'cost.view', { type: 'timeEntry', personId: row.personId, projectId: row.projectId })
  return {
    currency, showCosts: rows.some(seesCost),
    rows: known
      .map(({ id, name, photoId }) => {
        const part = rows.filter(({ personId }) => personId === id)
        const costs = part.map((row) => (seesCost(row) ? cost(row) : null))
        return {
          id, name, photoId,
          minutes: sumBy(part, ({ worked }) => worked), billableMinutes: sumBy(part.filter(({ billable }) => billable), ({ worked }) => worked),
          cost: costs.every((value) => value !== null) ? sumBy(costs, (value) => value ?? 0) : null,
          expenses: byCurrency(spent.filter(({ personId }) => personId === id), ({ amount }) => amount),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}
