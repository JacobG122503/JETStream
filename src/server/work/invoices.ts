/** Invoices. The rules of billing are in src/server/billing; this is what people see and start. */
import { and, asc, desc, eq, gte, inArray, isNull, lte, type SQL } from 'drizzle-orm'
import type { InvoiceDetails, PrintedDocument } from '../../shared/billing'
import type { IsoDate } from '../../shared/dates'
import type { InvoiceList, InvoiceRow, NewInvoiceInput, UnbilledClient } from '../../shared/work'
import type { Actor } from '../access/actor'
import { can, ownId, requirePermission, requireRecord } from '../access/decisions'
import { readFacts } from '../access/facts'
import { filterFor } from '../access/filters'
import { invalidInput } from '../api/input'
import { addEntriesToInvoice, createInvoiceFromEntries } from '../billing'
import type { AppContext } from '../context'
import { type Db, sumExact, type Tx } from '../db'
import {
  clients, expenseReceipts, expenses, files, invoiceAttachments, invoiceExpenses, invoiceLines, invoiceLinks, invoiceMessages, invoices, invoiceWriteOffs, payments, projects, refunds,
  retainerEntries, retainers, timeEntries,
} from '../db/schema'
import { NotFoundError } from '../errors'
import { getSettings } from '../people/lookup'
import { companyHead, contactsOf, dueDate, toLinks, toMessages } from './documents'
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

type Invoice = typeof invoices.$inferSelect

/** What is printed of an invoice. */
export async function printInvoice(db: Db, invoice: Invoice, client: typeof clients.$inferSelect): Promise<PrintedDocument> {
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)).orderBy(asc(invoiceLines.position), asc(invoiceLines.id))
  const { number, currency, subject, purchaseOrder, notes, issuedOn, subtotal, discountPercent, discountAmount, tax1Name, tax1Percent, tax1Amount, tax2Name, tax2Percent, tax2Amount, total } = invoice
  return {
    number, currency, subject, purchaseOrder, notes, issuedOn, subtotal, discountPercent, discountAmount, tax1Name, tax1Percent, tax1Amount, tax2Name, tax2Percent, tax2Amount, total,
    company: await companyHead(db), clientName: client.name, clientAddress: client.address,
    lines: lines.map(({ id, description, quantity, unitPrice, amount, kind, minutes, projectId, categoryId, tax1, tax2 }) => ({ id, description, quantity, unitPrice, amount, kind, minutes, projectId, categoryId, tax1, tax2 })),
  }
}

const receiptsOf = (db: Db | Tx, invoiceId: number) =>
  db
    .select({ id: expenseReceipts.fileId })
    .from(expenseReceipts)
    .innerJoin(invoiceExpenses, eq(invoiceExpenses.expenseId, expenseReceipts.expenseId))
    .innerJoin(invoiceLines, eq(invoiceLines.id, invoiceExpenses.lineId))
    .where(eq(invoiceLines.invoiceId, invoiceId))

export const attachmentsOf = (db: Db, invoiceId: number) =>
  db.select({ id: files.id, name: files.name }).from(invoiceAttachments).innerJoin(files, eq(files.id, invoiceAttachments.fileId)).where(eq(invoiceAttachments.invoiceId, invoiceId)).orderBy(asc(files.id))

export async function readInvoice(ctx: AppContext, actor: Actor, id: number): Promise<InvoiceDetails> {
  const { db } = ctx
  const facts = await readFacts(db, 'invoice', id)
  requireRecord(actor, { view: 'invoices.manage' }, facts, id)
  const [row] = await select(db, eq(invoices.id, id))
  if (!row || !facts) throw new NotFoundError(id)
  const { invoice, client } = row
  const paid = await db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(asc(payments.paidOn), asc(payments.id))
  const given = paid.length === 0 ? [] : await db.select().from(refunds).where(inArray(refunds.paymentId, paid.map((payment) => payment.id))).orderBy(asc(refunds.id))
  const [writeOff] = await db.select().from(invoiceWriteOffs).where(eq(invoiceWriteOffs.invoiceId, id))
  const messages = await db.select().from(invoiceMessages).where(eq(invoiceMessages.invoiceId, id)).orderBy(desc(invoiceMessages.createdAt), desc(invoiceMessages.id))
  const links = await db.select().from(invoiceLinks).where(eq(invoiceLinks.invoiceId, id)).orderBy(desc(invoiceLinks.id))
  const attachments = await attachmentsOf(db, id)
  const receipts = await receiptsOf(db, id)
  const canManagePayments = can(actor, 'payments.manage', facts)
  return {
    ...(await printInvoice(db, invoice, client)),
    ...toRow(row, await todayOf(db, ownId(actor), ctx.now())),
    version: invoice.version, paymentTerms: invoice.paymentTerms, paidAmount: invoice.paidAmount,
    payments: paid.map((payment) => ({
      id: payment.id, paidOn: payment.paidOn, amount: payment.amount, method: payment.method, reference: payment.reference, notes: payment.notes,
      simulated: payment.provider === simulated,
      refunds: given.filter(({ paymentId }) => paymentId === payment.id).map(({ id: refundId, amount, refundedOn, reason }) => ({ id: refundId, amount, refundedOn, reason })),
    })),
    writeOff: writeOff ? { amount: writeOff.amount, on: writeOff.writtenOffOn, reason: writeOff.reason } : null,
    messages: await toMessages(db, messages),
    links: toLinks(links),
    attachments,
    receipts: receipts.filter((receipt) => !attachments.some((one) => one.id === receipt.id)).length,
    recurring: invoice.recurringInvoiceId !== null,
    retainers: canManagePayments ? await retainersWithMoney(db, client.id, invoice.currency) : [],
    contacts: await contactsOf(db, client.id),
    canPay: invoice.status === 'open' && canManagePayments,
    canManagePayments,
  }
}

/** The client's retainers that can still pay something. */
export async function retainersWithMoney(db: Db, clientId: number, currency: string) {
  const rows = await db
    .select({ id: retainers.id, name: retainers.name, balance: sumExact(retainerEntries.amount) })
    .from(retainers)
    .innerJoin(retainerEntries, eq(retainerEntries.retainerId, retainers.id))
    .where(and(eq(retainers.clientId, clientId), eq(retainers.currency, currency), eq(retainers.status, 'active')))
    .groupBy(retainers.id, retainers.name)
  return rows.filter(({ balance }) => balance > 0)
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
  const taxes = { tax1: client.tax1Percent !== null, tax2: client.tax2Percent !== null }
  const invoice = await createInvoiceFromEntries(
    db,
    {
      clientId, subject, notes: settings.invoiceNotes, currency: client.currency, discountPercent: client.discountPercent, tax1Name: client.tax1Name,
      tax1Percent: client.tax1Percent, tax2Name: client.tax2Name, tax2Percent: client.tax2Percent, issuedOn, dueOn: dueDate(issuedOn, client.paymentTerms, client.paymentTermDays),
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

/** Adds what is not billed yet on the client's projects to an invoice. */
export async function addUnbilled(ctx: AppContext, actor: Actor, id: number, version: number, input: Omit<NewInvoiceInput, 'clientId' | 'subject'>): Promise<void> {
  const { db } = ctx
  requireRecord(actor, { view: 'invoices.manage' }, await readFacts(db, 'invoice', id), id)
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id))
  if (!invoice) throw new NotFoundError(id)
  const chosen = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.clientId, invoice.clientId), inArray(projects.id, input.projectIds.length > 0 ? input.projectIds : [0])))
  if (chosen.length < Math.max(1, input.projectIds.length) || !chosen.every((project) => can(actor, 'invoices.manage', { type: 'project', projectId: project.id }))) {
    throw invalidInput({ projectIds: 'Choose projects from the list.' })
  }
  const ids = chosen.map((project) => project.id)
  const { time, spent } = await loadUnbilled(db, actor, { time: inArray(timeEntries.projectId, ids), expenses: inArray(expenses.projectId, ids) }, input)
  await addEntriesToInvoice(db, { id, version }, {
    timeEntries: time.filter(({ amount }) => amount !== null).map((entry) => ({ id: entry.id, version: entry.version })),
    expenses: input.withExpenses ? spent.map(({ expense }) => ({ id: expense.id, version: expense.version })) : [],
    timeGrouping: input.grouping, timeLines: { tax1: invoice.tax1Percent !== null, tax2: invoice.tax2Percent !== null }, expenseLines: {},
  })
}

