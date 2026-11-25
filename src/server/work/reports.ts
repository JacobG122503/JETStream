/** Hours and what they are worth, over a period. */
import { and, between, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import { addDays, type IsoDate } from '../../shared/dates'
import { periodCapacity } from '../../shared/calc'
import type { DetailedTime, ExpenseReport, PaymentReport, ReportOptions, ReportRow, TimeReport } from '../../shared/work'
import type { Actor } from '../access/actor'
import { can, holds, ownId, requirePermission } from '../access/decisions'
import { invalidInput } from '../api/input'
import { filterFor } from '../access/filters'
import type { AppContext } from '../context'
import type { Db } from '../db'
import {
  clients, expenseCategories, expenses, invoiceExpenses, invoices, payments, people, projectMembers, projects, projectTags, projectTasks, refunds, tags, tasks, timeEntries,
} from '../db/schema'
import { isCurrentMembership } from '../people/membership'
import { byCurrency, groupRows, isUnbilled, loadValued, sumBy, type Valued } from './figures'
import { listDepartments } from './people'

const mostRange = 5 * 366

export interface ReportPeriod {
  from: IsoDate
  to: IsoDate
  /** Leaves out archived projects and clients. */
  activeOnly: boolean
  /** Of the people; empty for all. */
  department?: string
  /** Counts billable amounts of fixed-fee projects, by their rates. */
  fixedFee?: boolean
}

export async function readTimeReport(ctx: AppContext, actor: Actor, { from, to, activeOnly, department = '', fixedFee = false }: ReportPeriod): Promise<TimeReport> {
  checkPeriod({ from, to })
  const { db } = ctx
  const own = eq(timeEntries.personId, ownId(actor))
  const team = holds(actor, 'time.view')
  const scope = team ? or(own, filterFor(db, actor, 'time.view', 'timeEntry')) : own
  const active = activeOnly ? and(isNull(projects.archivedAt), isNull(clients.archivedAt)) : undefined
  const inDepartment = department === '' ? undefined : eq(people.department, department)
  const rows = await loadValued(db, and(scope, between(timeEntries.spentOn, from, to), active, inDepartment), { fixedFee })
  const seesMoney = ({ projectId }: Valued) => can(actor, 'billable.view', { type: 'project', projectId })
  const money = rows.filter(seesMoney)

  const spent = holds(actor, 'billable.view')
    ? await db
        .select({ projectId: expenses.projectId, currency: expenses.currency, amount: expenses.amount })
        .from(expenses)
        .innerJoin(projects, eq(projects.id, expenses.projectId))
        .innerJoin(clients, eq(clients.id, projects.clientId))
        .innerJoin(people, eq(people.id, expenses.personId))
        .leftJoin(invoiceExpenses, eq(invoiceExpenses.expenseId, expenses.id))
        .where(
          and(
            team ? or(eq(expenses.personId, ownId(actor)), filterFor(db, actor, 'time.view', 'expense')) : eq(expenses.personId, ownId(actor)),
            between(expenses.spentOn, from, to), active, inDepartment, eq(expenses.billable, true), eq(expenses.billedOutside, false), isNull(invoiceExpenses.lineId), ne(projects.type, 'fixed_fee'),
          ),
        )
    : []
  const unbilled = [
    ...money.filter((row) => isUnbilled(row) && row.projectType !== 'fixed_fee').map(({ currency, amount }) => ({ currency, amount: amount ?? 0 })),
    ...spent.filter(({ projectId }) => can(actor, 'billable.view', { type: 'project', projectId })),
  ]
  const known = new Map(
    (await db.select({ id: people.id, photoId: people.photoFileId, capacity: people.weeklyCapacityMinutes }).from(people)).map((person) => [person.id, person]),
  )

  const group = (keyOf: (row: Valued) => number, describe: (row: Valued) => Pick<ReportRow, 'name' | 'sub'>): ReportRow[] =>
    [...groupRows(rows, keyOf)]
      .map(([id, part]) => {
        const currencies = [...new Set(part.map(({ currency }) => currency))]
        const complete = part.every(seesMoney) && currencies.length === 1
        return {
          id, ...describe(part[0] as Valued),
          minutes: sumBy(part, ({ worked }) => worked),
          billableMinutes: sumBy(part.filter(({ billable }) => billable), ({ worked }) => worked),
          amount: complete ? sumBy(part, ({ amount }) => amount ?? 0) : null,
          ...(currencies.length === 1 && { currency: currencies[0] }),
        }
      })
      .sort((a, b) => b.minutes - a.minutes)

  return {
    from, to, scope: team ? 'team' : 'own',
    minutes: sumBy(rows, ({ worked }) => worked),
    billableMinutes: sumBy(rows.filter(({ billable }) => billable), ({ worked }) => worked),
    showAmounts: holds(actor, 'billable.view'),
    amounts: byCurrency(money, ({ amount }) => amount ?? 0),
    uninvoiced: byCurrency(unbilled, ({ amount }) => amount),
    byClient: group((row) => row.clientId, ({ client }) => ({ name: client })),
    byProject: group((row) => row.projectId, ({ project, client }) => ({ name: project, sub: client })),
    byTask: group((row) => row.taskId, ({ task }) => ({ name: task })),
    byPerson: group((row) => row.personId, ({ person }) => ({ name: person })).map((row) => ({
      ...row, photoId: known.get(row.id)?.photoId ?? null, capacityMinutes: periodCapacity(known.get(row.id)?.capacity ?? 0, from, to),
    })),
    departments: team ? await listDepartments(db) : [],
  }
}

const mostRows = 20_000

export function checkPeriod({ from, to }: Pick<ReportPeriod, 'from' | 'to'>) {
  if (from > to) throw invalidInput({ to: 'The end is before the start.' })
  if (addDays(from, mostRange) < to) throw invalidInput({ to: 'Choose at most five years.' })
}

const byName = <T extends { name: string }>(rows: T[]) => rows.sort((a, b) => a.name.localeCompare(b.name))
const unique = <T extends { id: number }>(rows: readonly T[]) => [...new Map(rows.map((row) => [row.id, row])).values()]

/** What detailed reports can be filtered by: what the actor sees, also without time in the period. */
async function readOptions(db: Db, actor: Actor): Promise<{ all: ReportOptions; tagsOf: (projectId: number) => number[] }> {
  const own = ownId(actor)
  const mine = db.select({ id: projectMembers.projectId }).from(projectMembers).where(and(eq(projectMembers.personId, own), isCurrentMembership()))
  const tracked = db.select({ id: timeEntries.projectId }).from(timeEntries).where(filterFor(db, actor, 'time.view', 'timeEntry', { orOwner: true }))
  const spent = db.select({ id: expenses.projectId }).from(expenses).where(filterFor(db, actor, 'time.view', 'expense', { orOwner: true }))
  const seen = await db
    .select({ id: projects.id, name: projects.name, archivedAt: projects.archivedAt, clientId: clients.id, client: clients.name, clientArchivedAt: clients.archivedAt })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(or(filterFor(db, actor, 'projects.view', 'project'), inArray(projects.id, mine), inArray(projects.id, tracked), inArray(projects.id, spent)))
  const ids = seen.length > 0 ? seen.map(({ id }) => id) : [0]
  const used = await db.selectDistinct({ id: tasks.id, name: tasks.name, archivedAt: tasks.archivedAt }).from(projectTasks).innerJoin(tasks, eq(tasks.id, projectTasks.taskId)).where(inArray(projectTasks.projectId, ids))
  const tagged = await db.select({ projectId: projectTags.projectId, id: tags.id, name: tags.name }).from(projectTags).innerJoin(tags, eq(tags.id, projectTags.tagId)).where(inArray(projectTags.projectId, ids))
  const onSeen = db.select({ id: timeEntries.personId }).from(timeEntries).where(filterFor(db, actor, 'time.view', 'timeEntry'))
  const spentSeen = db.select({ id: expenses.personId }).from(expenses).where(filterFor(db, actor, 'time.view', 'expense'))
  const persons = await db
    .select({ id: people.id, name: people.name, status: people.status })
    .from(people)
    .where(and(ne(people.status, 'pending'), or(eq(people.id, own), filterFor(db, actor, 'time.view', 'person'), inArray(people.id, onSeen), inArray(people.id, spentSeen))))
  const categories = await db.select({ id: expenseCategories.id, name: expenseCategories.name, archivedAt: expenseCategories.archivedAt }).from(expenseCategories)
  return {
    all: {
      clients: byName(unique(seen.map(({ clientId, client, clientArchivedAt }) => ({ id: clientId, name: client, archived: clientArchivedAt !== null })))),
      projects: byName(seen.map(({ id, name, client, archivedAt, clientArchivedAt }) => ({ id, name: `${name} (${client})`, archived: archivedAt !== null || clientArchivedAt !== null }))),
      tasks: byName(used.map(({ id, name, archivedAt }) => ({ id, name, archived: archivedAt !== null }))),
      categories: byName(categories.map(({ id, name, archivedAt }) => ({ id, name, archived: archivedAt !== null }))),
      tags: byName(unique(tagged.map(({ id, name }) => ({ id, name, archived: false })))),
      people: byName(persons.map(({ id, name, status }) => ({ id, name, archived: status === 'archived' }))),
    },
    tagsOf: (projectId) => tagged.filter((tag) => tag.projectId === projectId).map(({ id }) => id),
  }
}

/** Every entry of a period that the actor may see. */
export async function readDetailedTime(ctx: AppContext, actor: Actor, period: Pick<ReportPeriod, 'from' | 'to'>): Promise<DetailedTime> {
  checkPeriod(period)
  const { db } = ctx
  const own = eq(timeEntries.personId, ownId(actor))
  const team = holds(actor, 'time.view')
  const options = await readOptions(db, actor)
  const rows = await loadValued(db, and(team ? or(own, filterFor(db, actor, 'time.view', 'timeEntry')) : own, between(timeEntries.spentOn, period.from, period.to)))
  if (rows.length > mostRows) throw invalidInput({ to: 'That is too much for one report. Choose a shorter period.' })
  return {
    showAmounts: holds(actor, 'billable.view'), scope: team ? 'team' : 'own', options: options.all,
    rows: rows
      .sort((a, b) => b.spentOn.localeCompare(a.spentOn) || b.id - a.id)
      .map((row) => ({
        id: row.id, spentOn: row.spentOn, clientId: row.clientId, client: row.client, projectId: row.projectId, project: row.project, taskId: row.taskId, task: row.task,
        personId: row.personId, person: row.person, tagIds: options.tagsOf(row.projectId), notes: row.notes, minutes: row.worked, billable: row.billable,
        amount: can(actor, 'billable.view', { type: 'project', projectId: row.projectId }) && row.billable ? row.amount : null, currency: row.currency,
        invoiced: row.invoiceLineId !== null || row.billedOutside, status: row.status,
      })),
  }
}

export async function readExpenseReport(ctx: AppContext, actor: Actor, period: Pick<ReportPeriod, 'from' | 'to'>): Promise<ExpenseReport> {
  checkPeriod(period)
  const { db } = ctx
  const own = eq(expenses.personId, ownId(actor))
  const scope = holds(actor, 'time.view') ? or(own, filterFor(db, actor, 'time.view', 'expense')) : own
  const rows = await db
    .select({ expense: expenses, project: projects.name, clientId: clients.id, client: clients.name, category: expenseCategories.name, person: people.name, lineId: invoiceExpenses.lineId })
    .from(expenses)
    .innerJoin(projects, eq(projects.id, expenses.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .innerJoin(people, eq(people.id, expenses.personId))
    .leftJoin(invoiceExpenses, eq(invoiceExpenses.expenseId, expenses.id))
    .where(and(scope, between(expenses.spentOn, period.from, period.to)))
    .orderBy(desc(expenses.spentOn), desc(expenses.id))
    .limit(mostRows)
  const options = await readOptions(db, actor)
  return {
    options: options.all,
    rows: rows.map(({ expense, project, clientId, client, category, person, lineId }) => ({
      id: expense.id, spentOn: expense.spentOn, clientId, client, projectId: expense.projectId, project, categoryId: expense.categoryId, category,
      personId: expense.personId, person, tagIds: options.tagsOf(expense.projectId), notes: expense.notes, amount: expense.amount, currency: expense.currency, billable: expense.billable,
      invoiced: lineId !== null || expense.billedOutside, reimbursementStatus: expense.reimbursementStatus,
    })),
  }
}

/** Money that came in, on invoices the actor handles. */
export async function readPaymentReport(ctx: AppContext, actor: Actor, period: Pick<ReportPeriod, 'from' | 'to'>): Promise<PaymentReport> {
  checkPeriod(period)
  requirePermission(actor, 'invoices.manage')
  const { db } = ctx
  const rows = await db
    .select({ payment: payments, number: invoices.number, currency: invoices.currency, client: clients.name })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(filterFor(db, actor, 'invoices.manage', 'invoice'), between(payments.paidOn, period.from, period.to)))
    .orderBy(desc(payments.paidOn), desc(payments.id))
    .limit(mostRows)
  const given = await db.select({ paymentId: refunds.paymentId, amount: refunds.amount }).from(refunds)
  return {
    rows: rows.map(({ payment, number, currency, client }) => ({
      id: payment.id, paidOn: payment.paidOn, invoice: { id: payment.invoiceId, number }, client, method: payment.method, reference: payment.reference, amount: payment.amount,
      refunded: sumBy(given.filter(({ paymentId }) => paymentId === payment.id), ({ amount }) => amount), currency, simulated: payment.provider === 'simulated',
    })),
  }
}
