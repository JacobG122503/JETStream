/** Hours and what they are worth, over a period. */
import { and, between, desc, eq, isNull, or } from 'drizzle-orm'
import { addDays, type IsoDate } from '../../shared/dates'
import type { DetailedTime, ExpenseReport, PaymentReport, ReportRow, TimeReport } from '../../shared/work'
import type { Actor } from '../access/actor'
import { can, holds, ownId, requirePermission } from '../access/decisions'
import { invalidInput } from '../api/input'
import { filterFor } from '../access/filters'
import type { AppContext } from '../context'
import { clients, expenseCategories, expenses, invoiceExpenses, invoices, payments, people, projects, refunds, timeEntries } from '../db/schema'
import { byCurrency, groupRows, isUnbilled, loadValued, sumBy, type Valued } from './figures'

const mostRange = 5 * 366

export interface ReportPeriod {
  from: IsoDate
  to: IsoDate
  /** Leaves out archived projects and clients. */
  activeOnly: boolean
}

export async function readTimeReport(ctx: AppContext, actor: Actor, { from, to, activeOnly }: ReportPeriod): Promise<TimeReport> {
  if (from > to) throw invalidInput({ to: 'The end is before the start.' })
  if (addDays(from, mostRange) < to) throw invalidInput({ to: 'Choose at most five years.' })
  const { db } = ctx
  const own = eq(timeEntries.personId, ownId(actor))
  const team = holds(actor, 'time.view')
  const scope = team ? or(own, filterFor(db, actor, 'time.view', 'timeEntry')) : own
  const active = activeOnly ? and(isNull(projects.archivedAt), isNull(clients.archivedAt)) : undefined
  const rows = await loadValued(db, and(scope, between(timeEntries.spentOn, from, to), active))
  const seesMoney = ({ projectId }: Valued) => can(actor, 'billable.view', { type: 'project', projectId })
  const money = rows.filter(seesMoney)

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
    uninvoiced: byCurrency(money.filter(isUnbilled), ({ amount }) => amount ?? 0),
    byClient: group((row) => row.clientId, ({ client }) => ({ name: client })),
    byProject: group((row) => row.projectId, ({ project, client }) => ({ name: project, sub: client })),
    byTask: group((row) => row.taskId, ({ task }) => ({ name: task })),
    byPerson: group((row) => row.personId, ({ person }) => ({ name: person })),
  }
}

const mostRows = 20_000

function checkPeriod({ from, to }: Pick<ReportPeriod, 'from' | 'to'>) {
  if (from > to) throw invalidInput({ to: 'The end is before the start.' })
  if (addDays(from, mostRange) < to) throw invalidInput({ to: 'Choose at most five years.' })
}

/** Every entry of a period that the actor may see. */
export async function readDetailedTime(ctx: AppContext, actor: Actor, period: Pick<ReportPeriod, 'from' | 'to'>): Promise<DetailedTime> {
  checkPeriod(period)
  const { db } = ctx
  const own = eq(timeEntries.personId, ownId(actor))
  const team = holds(actor, 'time.view')
  const rows = await loadValued(db, and(team ? or(own, filterFor(db, actor, 'time.view', 'timeEntry')) : own, between(timeEntries.spentOn, period.from, period.to)))
  if (rows.length > mostRows) throw invalidInput({ to: 'That is too much for one report. Choose a shorter period.' })
  return {
    showAmounts: holds(actor, 'billable.view'), scope: team ? 'team' : 'own',
    rows: rows
      .sort((a, b) => b.spentOn.localeCompare(a.spentOn) || b.id - a.id)
      .map((row) => ({
        id: row.id, spentOn: row.spentOn, client: row.client, project: row.project, task: row.task, person: row.person, notes: row.notes, minutes: row.worked, billable: row.billable,
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
    .select({ expense: expenses, project: projects.name, client: clients.name, category: expenseCategories.name, person: people.name, lineId: invoiceExpenses.lineId })
    .from(expenses)
    .innerJoin(projects, eq(projects.id, expenses.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .innerJoin(people, eq(people.id, expenses.personId))
    .leftJoin(invoiceExpenses, eq(invoiceExpenses.expenseId, expenses.id))
    .where(and(scope, between(expenses.spentOn, period.from, period.to)))
    .orderBy(desc(expenses.spentOn), desc(expenses.id))
    .limit(mostRows)
  return {
    rows: rows.map(({ expense, project, client, category, person, lineId }) => ({
      id: expense.id, spentOn: expense.spentOn, client, project, category, person, notes: expense.notes, amount: expense.amount, currency: expense.currency, billable: expense.billable,
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
