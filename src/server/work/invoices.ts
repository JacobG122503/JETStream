/** Invoices. The rules of billing are in src/server/billing; this is what people see and start. */
import { and, asc, desc, eq, gte, inArray, isNull, lte, type SQL } from 'drizzle-orm'
import { addDays, type IsoDate } from '../../shared/dates'
import type { PaymentMethod } from '../../shared/domain'
import type { InvoiceDetails, InvoiceList, InvoiceRow, NewInvoiceInput, UnbilledClient } from '../../shared/work'
import { type Actor, actorId } from '../access/actor'
import { can, ownId, requirePermission, requireRecord } from '../access/decisions'
import { readFacts } from '../access/facts'
import { filterFor } from '../access/filters'
import { invalidInput } from '../api/input'
import { createInvoiceFromEntries, deleteInvoice, lockInvoice, recordPayment } from '../billing'
import type { AppContext } from '../context'
import { type Db, runTransaction } from '../db'
import { clients, expenses, invoiceExpenses, invoiceLines, invoices, payments, projects, timeEntries } from '../db/schema'
import { ApiError, NotFoundError, StaleError } from '../errors'
import { getSettings } from '../people/lookup'
import { groupRows, isUnbilled, loadValued, notInvoiced, sumBy } from './figures'
import { todayOf } from './time'

type Row = { invoice: typeof invoices.$inferSelect; client: typeof clients.$inferSelect }

const toRow = ({ invoice, client }: Row, today: IsoDate): InvoiceRow => ({
  id: invoice.id, number: invoice.number, client: { id: client.id, name: client.name }, subject: invoice.subject, status: invoice.status,
  issuedOn: invoice.issuedOn, dueOn: invoice.dueOn, late: invoice.status === 'open' && invoice.dueOn < today, currency: invoice.currency,
  total: invoice.total, dueAmount: invoice.dueAmount,
})

const select = (db: Db, condition: SQL | undefined) =>
  db
    .select({ invoice: invoices, client: clients })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(condition)
    .orderBy(desc(invoices.issuedOn), desc(invoices.id))

export async function listInvoices(ctx: AppContext, actor: Actor, clientId?: number): Promise<InvoiceList> {
  requirePermission(actor, 'invoices.manage')
  const today = await todayOf(ctx.db, ownId(actor), ctx.now())
  const ofClient = clientId === undefined ? undefined : eq(invoices.clientId, clientId)
  const rows = await select(ctx.db, and(filterFor(ctx.db, actor, 'invoices.manage', 'invoice'), ofClient))
  return { today, invoices: rows.map((row) => toRow(row, today)) }
}

const simulated = 'simulated'

export async function readInvoice(ctx: AppContext, actor: Actor, id: number): Promise<InvoiceDetails> {
  const { db } = ctx
  requireRecord(actor, { view: 'invoices.manage' }, await readFacts(db, 'invoice', id), id)
  const [row] = await select(db, eq(invoices.id, id))
  if (!row) throw new NotFoundError(id)
  const { invoice, client } = row
  const settings = await getSettings(db)
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position), asc(invoiceLines.id))
  const paid = await db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(asc(payments.paidOn), asc(payments.id))
  const { subtotal, discountPercent, discountAmount, tax1Name, tax1Percent, tax1Amount, tax2Name, tax2Percent, tax2Amount, paidAmount } = invoice
  return {
    ...toRow(row, await todayOf(db, ownId(actor), ctx.now())),
    version: invoice.version,
    company: { name: settings.name, address: settings.address },
    clientAddress: client.address, purchaseOrder: invoice.purchaseOrder, notes: invoice.notes,
    lines: lines.map(({ id: lineId, description, quantity, unitPrice, amount, kind, minutes }) => ({ id: lineId, description, quantity, unitPrice, amount, kind, minutes })),
    subtotal, discountPercent, discountAmount, tax1Name, tax1Percent, tax1Amount, tax2Name, tax2Percent, tax2Amount, paidAmount,
    payments: paid.map((payment) => ({
      id: payment.id, paidOn: payment.paidOn, amount: payment.amount, method: payment.method, reference: payment.reference,
      simulated: payment.provider === simulated,
    })),
    canPay: invoice.status === 'open' && can(actor, 'payments.manage', (await readFacts(db, 'invoice', id)) ?? { type: 'client', clientId: 0 }),
  }
}

interface Period {
  from: IsoDate | null
  to: IsoDate | null
}

async function loadUnbilled(db: Db, actor: Actor, condition: { time?: SQL; expenses?: SQL }, { from, to }: Period) {
  const time = (
    await loadValued(
      db,
      and(
        condition.time, eq(timeEntries.billable, true), notInvoiced(), from ? gte(timeEntries.spentOn, from) : undefined,
        to ? lte(timeEntries.spentOn, to) : undefined,
      ),
    )
  ).filter((row) => isUnbilled(row) && can(actor, 'invoices.manage', { type: 'project', projectId: row.projectId }))
  const spent = (
    await db
      .select({ expense: expenses, project: projects, client: clients })
      .from(expenses)
      .innerJoin(projects, eq(projects.id, expenses.projectId))
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(invoiceExpenses, eq(invoiceExpenses.expenseId, expenses.id))
      .where(
        and(
          condition.expenses, eq(expenses.billable, true), eq(expenses.billedOutside, false), isNull(invoiceExpenses.lineId),
          from ? gte(expenses.spentOn, from) : undefined, to ? lte(expenses.spentOn, to) : undefined,
        ),
      )
  ).filter(
    ({ expense, project, client }) =>
      project.type !== 'non_billable' && expense.currency === client.currency && can(actor, 'invoices.manage', { type: 'project', projectId: project.id }),
  )
  return { time, spent }
}

/** Time and expenses that could be invoiced, by client and project. */
export async function listUnbilled(db: Db, actor: Actor, period: Period): Promise<UnbilledClient[]> {
  requirePermission(actor, 'invoices.manage')
  const { time, spent } = await loadUnbilled(db, actor, {}, period)
  const found = new Map<number, UnbilledClient>()
  const projectOf = (client: { id: number; name: string; currency: string }, project: { id: number; name: string; code: string }) => {
    const entry = found.get(client.id) ?? { ...client, total: 0, projects: [] }
    found.set(client.id, entry)
    let row = entry.projects.find(({ id }) => id === project.id)
    if (!row) entry.projects.push((row = { ...project, minutes: 0, timeAmount: 0, expenseAmount: 0, entries: 0, withoutRate: 0 }))
    return row
  }
  for (const [projectId, rows] of groupRows(time, (row) => row.projectId)) {
    const [first] = rows
    if (!first) continue
    const row = projectOf({ id: first.clientId, name: first.client, currency: first.currency }, { id: projectId, name: first.project, code: first.projectCode })
    const rated = rows.filter(({ amount }) => amount !== null)
    Object.assign(row, {
      minutes: sumBy(rated, ({ worked }) => worked), timeAmount: sumBy(rated, ({ amount }) => amount ?? 0), entries: rated.length,
      withoutRate: rows.length - rated.length,
    })
  }
  for (const { expense, project, client } of spent) {
    projectOf({ id: client.id, name: client.name, currency: client.currency }, { id: project.id, name: project.name, code: project.code }).expenseAmount += expense.amount
  }
  for (const client of found.values()) client.total = sumBy(client.projects, ({ timeAmount, expenseAmount }) => timeAmount + expenseAmount)
  return [...found.values()].filter(({ projects: rows }) => rows.some(({ entries, expenseAmount }) => entries > 0 || expenseAmount > 0)).sort((a, b) => a.name.localeCompare(b.name))
}

const termDays = { upon_receipt: 0, net_15: 15, net_30: 30, net_45: 45, net_60: 60 } as const

/** Makes a draft of everything that is not billed yet on the chosen projects. */
export async function createInvoice(ctx: AppContext, actor: Actor, input: NewInvoiceInput): Promise<number> {
  requirePermission(actor, 'invoices.manage')
  const { db } = ctx
  const { clientId, projectIds, grouping, withExpenses, subject } = input
  if (projectIds.length === 0) throw invalidInput({ projectIds: 'Choose at least one project.' })
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId))
  const chosen = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.clientId, clientId), inArray(projects.id, projectIds)))
  if (!client || chosen.length < projectIds.length || !projectIds.every((id) => can(actor, 'invoices.manage', { type: 'project', projectId: id }))) {
    throw invalidInput({ projectIds: 'Choose projects from the list.' })
  }
  const { time, spent } = await loadUnbilled(
    db, actor, { time: inArray(timeEntries.projectId, projectIds), expenses: inArray(expenses.projectId, projectIds) }, input,
  )
  const settings = await getSettings(db)
  const issuedOn = await todayOf(db, ownId(actor), ctx.now())
  const days = client.paymentTerms === 'custom' ? (client.paymentTermDays ?? 0) : termDays[client.paymentTerms]
  const taxes = { tax1: client.tax1Percent !== null, tax2: client.tax2Percent !== null }
  const invoice = await createInvoiceFromEntries(
    db,
    {
      clientId, subject, notes: settings.invoiceNotes, currency: client.currency, discountPercent: client.discountPercent, tax1Name: client.tax1Name,
      tax1Percent: client.tax1Percent, tax2Name: client.tax2Name, tax2Percent: client.tax2Percent, issuedOn, dueOn: addDays(issuedOn, days),
      paymentTerms: client.paymentTerms, createdBy: ownId(actor),
    },
    {
      timeEntries: time.filter(({ amount }) => amount !== null).map(({ id, version }) => ({ id, version })),
      expenses: withExpenses ? spent.map(({ expense }) => ({ id: expense.id, version: expense.version })) : [],
      timeGrouping: grouping, timeLines: taxes, expenseLines: {},
    },
  )
  return invoice.id
}

/** A draft becomes an open invoice. Nothing is sent: that is said wherever this is offered. */
export async function markSent(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  requireRecord(actor, { view: 'invoices.manage' }, await readFacts(ctx.db, 'invoice', id), id)
  await runTransaction(ctx.db, async (tx) => {
    const invoice = await lockInvoice(tx, id)
    if (invoice.version !== version) throw new StaleError(id, version)
    if (invoice.status !== 'draft') throw new ApiError(409, 'not_a_draft', 'Only a draft can be marked as sent.')
    await tx.update(invoices).set({ status: 'open', sentAt: ctx.now() }).where(eq(invoices.id, id))
  })
}

export interface PaymentInput {
  amount: number
  paidOn: IsoDate
  method: Exclude<PaymentMethod, 'online' | 'retainer'>
  reference: string
}

/** Money that came in some other way: nothing is charged here. */
export async function addPayment(ctx: AppContext, actor: Actor, id: number, input: PaymentInput): Promise<void> {
  requireRecord(actor, { view: 'invoices.manage', action: 'payments.manage' }, await readFacts(ctx.db, 'invoice', id), id)
  await recordPayment(ctx.db, { invoiceId: id, ...input, recordedBy: actorId(actor) })
}

/** Deletes a draft; its time and expenses can be billed again. */
export async function removeDraft(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  requireRecord(actor, { view: 'invoices.manage' }, await readFacts(ctx.db, 'invoice', id), id)
  const [invoice] = await ctx.db.select().from(invoices).where(eq(invoices.id, id))
  if (invoice && invoice.status !== 'draft') throw new ApiError(409, 'not_a_draft', 'Only a draft can be deleted.')
  await deleteInvoice(ctx.db, id, version)
}

