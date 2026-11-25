/** Time with the amounts it is worth, as billing would calculate them. */
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import { type DatedRate, resolveBillableRate, roundMinutes, timeAmount, type TimeRounding } from '../../shared/calc'
import type { Db, Tx } from '../db'
import { clients, invoiceTimeEntries, people, personRates, projectMembers, projects, projectTasks, tasks, timeEntries } from '../db/schema'
import { getSettings } from '../people/lookup'

/** The columns of an entry and what it belongs to. */
export const timeColumns = {
  id: timeEntries.id, version: timeEntries.version, personId: timeEntries.personId, person: people.name, projectId: timeEntries.projectId,
  project: projects.name, projectCode: projects.code, projectType: projects.type, clientId: clients.id, client: clients.name,
  currency: clients.currency, taskId: timeEntries.taskId, task: tasks.name, spentOn: timeEntries.spentOn, minutes: timeEntries.minutes,
  startMinute: timeEntries.startMinute, endMinute: timeEntries.endMinute,
  timerStartedAt: timeEntries.timerStartedAt, notes: timeEntries.notes, billable: timeEntries.billable, status: timeEntries.status,
  billedOutside: timeEntries.billedOutside, rateMethod: projects.rateMethod, projectRate: projects.rate, taskRate: projectTasks.rate,
  defaultRate: tasks.defaultRate, invoiceLineId: invoiceTimeEntries.lineId,
} as const

export const selectTime = (db: Db | Tx) =>
  db
    .select(timeColumns)
    .from(timeEntries)
    .innerJoin(people, eq(people.id, timeEntries.personId))
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .innerJoin(projectTasks, and(eq(projectTasks.projectId, timeEntries.projectId), eq(projectTasks.taskId, timeEntries.taskId)))
    .leftJoin(invoiceTimeEntries, eq(invoiceTimeEntries.timeEntryId, timeEntries.id))

export type TimeRow = Awaited<ReturnType<typeof selectTime>>[number]

export interface Valued extends TimeRow {
  /** After time rounding, as reported and billed. */
  worked: number
  /** Null when no rate applies, 0 when it is not billed by the hour. */
  amount: number | null
}

/** Reads entries with what they are worth. With `fixedFee`, work for a fixed fee is worth what its rates say. */
export async function loadValued(db: Db | Tx, condition: SQL | undefined, { fixedFee = false } = {}): Promise<Valued[]> {
  const rows = await selectTime(db).where(condition)
  if (rows.length === 0) return []
  const settings = await getSettings(db)
  const rounding: TimeRounding = { mode: settings.roundingMode, increment: settings.roundingMinutes }
  const personIds = [...new Set(rows.map(({ personId }) => personId))]
  const projectIds = [...new Set(rows.map(({ projectId }) => projectId))]
  const members = await db
    .select({ projectId: projectMembers.projectId, personId: projectMembers.personId, rate: projectMembers.rate })
    .from(projectMembers)
    .where(inArray(projectMembers.projectId, projectIds))
  const memberRates = new Map(members.map(({ projectId, personId, rate }) => [`${projectId}/${personId}`, rate]))
  const dated = new Map<number, DatedRate[]>(personIds.map((id) => [id, []]))
  const stored = await db.select().from(personRates).where(and(eq(personRates.kind, 'billable'), inArray(personRates.personId, personIds)))
  for (const { personId, startsOn, rate } of stored) dated.get(personId)?.push({ startsOn, rate })

  return rows.map((row) => {
    const worked = roundMinutes(row.minutes, rounding)
    const resolved = resolveBillableRate({
      date: row.spentOn,
      billable: row.billable,
      project: { type: fixedFee && row.projectType === 'fixed_fee' ? 'time_materials' : row.projectType, rateMethod: row.rateMethod, rate: row.projectRate, currency: row.currency },
      task: { projectRate: row.taskRate, defaultRate: row.defaultRate },
      person: { projectRate: memberRates.get(`${row.projectId}/${row.personId}`) ?? null, rates: dated.get(row.personId) ?? [] },
      companyCurrency: settings.currency,
    })
    const amount = resolved.kind === 'rate' ? timeAmount(worked, resolved.rate) : resolved.kind === 'missing' ? null : 0
    return { ...row, worked, amount }
  })
}

/** Billable, not on an invoice, and not running. */
export const isUnbilled = ({ billable, invoiceLineId, billedOutside, projectType, timerStartedAt }: TimeRow): boolean =>
  billable && invoiceLineId === null && !billedOutside && projectType !== 'non_billable' && timerStartedAt === null

export const notInvoiced = () => isNull(invoiceTimeEntries.lineId)

export const sumBy = <T>(rows: readonly T[], value: (row: T) => number): number => rows.reduce((sum, row) => sum + value(row), 0)

export function groupRows<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const row of rows) {
    const group = groups.get(keyOf(row))
    if (group) group.push(row)
    else groups.set(keyOf(row), [row])
  }
  return groups
}

/** Amounts per currency, in the order of the currency codes. */
export function byCurrency<T extends { currency: string }>(rows: readonly T[], value: (row: T) => number): { currency: string; amount: number }[] {
  return [...groupRows(rows, ({ currency }) => currency)]
    .map(([currency, group]) => ({ currency, amount: sumBy(group, value) }))
    .filter(({ amount }) => amount !== 0)
    .sort((a, b) => a.currency.localeCompare(b.currency))
}
