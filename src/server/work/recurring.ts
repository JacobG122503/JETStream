/** Invoices that are made again and again. */
import { and, asc, count, desc, eq, lte } from 'drizzle-orm'
import type { RecurringDetails, RecurringInput, RecurringRow } from '../../shared/billing'
import { documentTotals, nextOccurrence } from '../../shared/calc'
import type { IsoDate } from '../../shared/dates'
import type { Actor } from '../access/actor'
import { can, ownId, requirePermission } from '../access/decisions'
import { invalidInput } from '../api/input'
import { allocateNumber, recalculateInvoice } from '../billing'
import { todayIn } from '../clock'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx, updateVersioned } from '../db'
import { clients, invoiceLines, invoices, recurringInvoiceLines, recurringInvoices } from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { getSettings } from '../people/lookup'
import { holdClient, logChange } from './common'
import { checkLines, checkTerms, dueDate, lineValues } from './documents'
import { defaultMessage, sendMessage } from './invoiceWork'
import { listInvoices } from './invoices'
import { notify } from './notify'
import { todayOf } from './time'

type Recurring = typeof recurringInvoices.$inferSelect

/** Every project on it, as with invoices; without any, its maker. */
async function seen(db: Db | Tx, actor: Actor, row: Recurring): Promise<boolean> {
  const lines = await db.select({ projectId: recurringInvoiceLines.projectId }).from(recurringInvoiceLines).where(eq(recurringInvoiceLines.recurringInvoiceId, row.id))
  const projectIds = [...new Set(lines.flatMap(({ projectId }) => (projectId === null ? [] : [projectId])))]
  return can(actor, 'invoices.manage', { type: 'invoice', createdBy: row.createdBy, projectIds })
}

async function toRow(db: Db, row: Recurring, client: string): Promise<RecurringRow> {
  const lines = await db.select().from(recurringInvoiceLines).where(eq(recurringInvoiceLines.recurringInvoiceId, row.id))
  const [made] = await db.select({ count: count() }).from(invoices).where(eq(invoices.recurringInvoiceId, row.id))
  return {
    id: row.id, client: { id: row.clientId, name: client }, subject: row.subject, currency: row.currency, total: documentTotals(lines, row).total, frequency: row.frequency,
    interval: row.interval, nextOn: row.nextOn, endsOn: row.endsOn, status: row.status, sendAutomatically: row.sendAutomatically, made: made?.count ?? 0,
  }
}

export async function listRecurring(db: Db, actor: Actor): Promise<{ recurring: RecurringRow[] }> {
  requirePermission(actor, 'invoices.manage')
  const rows = await db.select({ row: recurringInvoices, client: clients.name }).from(recurringInvoices).innerJoin(clients, eq(clients.id, recurringInvoices.clientId)).orderBy(asc(recurringInvoices.nextOn), asc(clients.name))
  const found: RecurringRow[] = []
  for (const { row, client } of rows) if (await seen(db, actor, row)) found.push(await toRow(db, row, client))
  return { recurring: found }
}

async function load(db: Db | Tx, actor: Actor, id: number): Promise<Recurring> {
  requirePermission(actor, 'invoices.manage')
  const [row] = await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, id))
  if (!row || !(await seen(db, actor, row))) throw new NotFoundError(id)
  return row
}

export async function readRecurring(ctx: AppContext, actor: Actor, id: number): Promise<RecurringDetails> {
  const { db } = ctx
  const row = await load(db, actor, id)
  const [client] = await db.select().from(clients).where(eq(clients.id, row.clientId))
  const lines = await db.select().from(recurringInvoiceLines).where(eq(recurringInvoiceLines.recurringInvoiceId, id)).orderBy(asc(recurringInvoiceLines.position))
  const ids = (await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.recurringInvoiceId, id))).map((invoice) => invoice.id)
  const { subject, purchaseOrder, notes, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent, version, paymentTerms, paymentTermDays, startsOn } = row
  return {
    ...(await toRow(db, row, client?.name ?? '')),
    subject, purchaseOrder, notes, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent, version, paymentTerms, paymentTermDays, startsOn,
    lines: lines.map(({ id: lineId, description, quantity, unitPrice, amount, projectId, categoryId, tax1, tax2 }) => ({
      id: lineId, description, quantity, unitPrice, amount, projectId, categoryId, tax1, tax2, kind: 'manual', minutes: null,
    })),
    invoices: (await listInvoices(ctx, actor, row.clientId)).invoices.filter((invoice) => ids.includes(invoice.id)),
  }
}

function check(input: RecurringInput) {
  if (input.lines.length === 0) throw invalidInput({ lines: 'Add at least one line.' })
  if ((input.paymentTerms === 'custom') !== (input.paymentTermDays !== null)) throw invalidInput({ paymentTermDays: 'Enter the days for custom terms.' })
  if (input.endsOn !== null && input.endsOn < input.startsOn) throw invalidInput({ endsOn: 'The end is before the start.' })
  if (documentTotals(input.lines, input).total < 0) throw invalidInput({ lines: 'The total cannot be below 0.' })
  const { paymentTerms, paymentTermDays, frequency, interval, startsOn, endsOn, sendAutomatically } = input
  return { ...checkTerms(input), paymentTerms, paymentTermDays, frequency, interval, startsOn, endsOn, sendAutomatically }
}

const storeLines = (tx: Tx, id: number, input: RecurringInput) => tx.insert(recurringInvoiceLines).values(lineValues(input.lines).map((line) => ({ ...line, recurringInvoiceId: id })))

/** The next date, or null when there is none before the end. */
const nextFrom = ({ startsOn, frequency, interval, endsOn }: Pick<Recurring, 'startsOn' | 'frequency' | 'interval' | 'endsOn'>, after: IsoDate): IsoDate | null => {
  const next = nextOccurrence(startsOn, frequency, interval, after)
  return endsOn !== null && next > endsOn ? null : next
}

const dayBefore = (date: IsoDate) => new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10)

export async function createRecurring(ctx: AppContext, actor: Actor, input: RecurringInput): Promise<number> {
  requirePermission(actor, 'invoices.manage')
  const values = check(input)
  return runTransaction(ctx.db, async (tx) => {
    const client = await holdClient(tx, input.clientId, 'use')
    if (!can(actor, 'clients.view', { type: 'client', clientId: client.id })) throw invalidInput({ clientId: 'Choose a client from the list.' })
    await checkLines(tx, actor, 'invoices.manage', client.id, input.lines)
    const [row] = await tx
      .insert(recurringInvoices)
      .values({ ...values, clientId: client.id, currency: client.currency, nextOn: nextFrom(values, dayBefore(values.startsOn)), createdBy: ownId(actor) })
      .returning()
    if (!row) throw new Error('The recurring invoice was not stored.')
    await storeLines(tx, row.id, input)
    await logChange(tx, actor, { action: 'created', type: 'invoice', id: null, summary: `Created a recurring invoice for ${client.name}` })
    return row.id
  })
}

export async function updateRecurring(ctx: AppContext, actor: Actor, id: number, { version, ...input }: RecurringInput & { version: number }): Promise<void> {
  const values = check(input)
  await runTransaction(ctx.db, async (tx) => {
    const row = await load(tx, actor, id)
    if (row.clientId !== input.clientId) throw invalidInput({ clientId: 'The client cannot be changed.' })
    const client = await holdClient(tx, row.clientId, 'use')
    const known = (await tx.select({ projectId: recurringInvoiceLines.projectId }).from(recurringInvoiceLines).where(eq(recurringInvoiceLines.recurringInvoiceId, id))).map(({ projectId }) => projectId)
    await checkLines(tx, actor, 'invoices.manage', client.id, input.lines, known)
    const [last] = await tx.select({ on: invoices.recurringOn }).from(invoices).where(eq(invoices.recurringInvoiceId, id)).orderBy(desc(invoices.recurringOn)).limit(1)
    const before = dayBefore(values.startsOn)
    const nextOn = row.status === 'ended' ? null : nextFrom(values, last?.on && last.on > before ? last.on : before)
    await updateVersioned(tx, recurringInvoices, id, version, { ...values, nextOn, ...(nextOn === null && { status: 'ended' as const }) })
    await tx.delete(recurringInvoiceLines).where(eq(recurringInvoiceLines.recurringInvoiceId, id))
    await storeLines(tx, id, input)
    await logChange(tx, actor, { action: 'updated', type: 'invoice', id: null, summary: `Changed a recurring invoice for ${client.name}` })
  })
}

/** What was missed while it was paused is not made later. */
export async function setRecurringStatus(ctx: AppContext, actor: Actor, id: number, status: 'active' | 'paused' | 'ended'): Promise<void> {
  const today = await todayOf(ctx.db, ownId(actor), ctx.now())
  await runTransaction(ctx.db, async (tx) => {
    const row = await load(tx, actor, id)
    if (row.status === status) return
    if (status === 'active') {
      await holdClient(tx, row.clientId, 'use')
      const nextOn = nextFrom(row, row.nextOn !== null && row.nextOn >= today ? dayBefore(row.nextOn) : dayBefore(today))
      if (nextOn === null) throw new ApiError(409, 'over', 'Its end has passed. Change the end first.')
      await tx.update(recurringInvoices).set({ status, nextOn }).where(eq(recurringInvoices.id, id))
    } else await tx.update(recurringInvoices).set({ status, ...(status === 'ended' && { nextOn: null }) }).where(eq(recurringInvoices.id, id))
    await logChange(tx, actor, { action: 'updated', type: 'invoice', id: null, summary: `Set a recurring invoice to ${status}` })
  })
}

export async function deleteRecurring(ctx: AppContext, actor: Actor, id: number): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    await load(tx, actor, id)
    if ((await tx.$count(invoices, eq(invoices.recurringInvoiceId, id))) > 0) throw new ApiError(409, 'in_use', 'Invoices were made from it. End it instead.')
    await tx.delete(recurringInvoices).where(eq(recurringInvoices.id, id))
  })
}

/** Makes what is due. Each date is made once, also when two servers or restarts try. */
export async function makeDueInvoices(ctx: AppContext): Promise<number> {
  const { timeZone } = await getSettings(ctx.db)
  const today = todayIn(timeZone, ctx.now())
  let made = 0
  const due = await ctx.db.select({ id: recurringInvoices.id }).from(recurringInvoices).where(and(eq(recurringInvoices.status, 'active'), lte(recurringInvoices.nextOn, today)))
  for (const { id } of due) {
    // Several, when the server was off for long.
    for (let round = 0; round < 60; round++) {
      const result = await makeOne(ctx, id, today)
      if (result === null) break
      made++
      if (result.send) await sendMade(ctx, result.invoiceId, result.createdBy)
      else await notify(ctx, [result.createdBy], { kind: 'recurring', title: 'A recurring invoice is ready', body: `Invoice ${result.number} was made as a draft.`, path: `/invoices/${result.invoiceId}` })
    }
  }
  return made
}

async function makeOne(ctx: AppContext, id: number, today: IsoDate) {
  return runTransaction(ctx.db, async (tx) => {
    const [seenRow] = await tx.select({ clientId: recurringInvoices.clientId }).from(recurringInvoices).where(eq(recurringInvoices.id, id))
    if (!seenRow) return null
    const [client] = await tx.select().from(clients).where(eq(clients.id, seenRow.clientId)).for('share')
    const [row] = await tx.select().from(recurringInvoices).where(eq(recurringInvoices.id, id)).for('update')
    if (!client || !row || row.status !== 'active' || row.nextOn === null || row.nextOn > today) return null
    if (client.archivedAt !== null) {
      await tx.update(recurringInvoices).set({ status: 'paused' }).where(eq(recurringInvoices.id, id))
      return null
    }
    const on = row.nextOn
    const nextOn = nextFrom(row, on)
    await tx.update(recurringInvoices).set({ nextOn, ...(nextOn === null && { status: 'ended' as const }) }).where(eq(recurringInvoices.id, id))
    if ((await tx.$count(invoices, and(eq(invoices.recurringInvoiceId, id), eq(invoices.recurringOn, on)))) > 0) return null
    const number = await allocateNumber(tx, 'invoice')
    const { clientId, subject, purchaseOrder, notes, currency, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent, paymentTerms, paymentTermDays, createdBy } = row
    const [invoice] = await tx
      .insert(invoices)
      .values({
        clientId, subject, purchaseOrder, notes, currency, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent, paymentTerms, number, issuedOn: on,
        dueOn: dueDate(on, paymentTerms, paymentTermDays), createdBy, recurringInvoiceId: id, recurringOn: on,
      })
      .returning()
    if (!invoice) throw new Error('The invoice was not stored.')
    const lines = await tx.select().from(recurringInvoiceLines).where(eq(recurringInvoiceLines.recurringInvoiceId, id)).orderBy(asc(recurringInvoiceLines.position))
    await tx.insert(invoiceLines).values(
      lines.map(({ position, categoryId, projectId, description, quantity, unitPrice, amount, tax1, tax2 }) => ({
        position, categoryId, projectId, description, quantity, unitPrice, amount, tax1, tax2, invoiceId: invoice.id, kind: 'manual' as const,
      })),
    )
    await recalculateInvoice(tx, invoice)
    return { invoiceId: invoice.id, number, createdBy, send: row.sendAutomatically }
  })
}

/** Without anyone to send it to, it stays a draft and its maker is told. */
async function sendMade(ctx: AppContext, invoiceId: number, createdBy: number): Promise<void> {
  const [invoice] = await ctx.db.select().from(invoices).where(eq(invoices.id, invoiceId))
  if (!invoice) return
  const message = await defaultMessage(ctx.db, invoice, 'sent')
  if (message.recipients.length > 0) await sendMessage(ctx, null, invoiceId, null, { kind: 'sent', ...message })
  else await notify(ctx, [createdBy], { kind: 'recurring', title: `Invoice ${invoice.number} was not sent`, body: 'The client has no contact with an email address. It was left as a draft.', path: `/invoices/${invoiceId}` })
}

