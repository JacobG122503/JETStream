/** Making, changing and sending invoices, and the money for them. */
import { and, eq, inArray, isNull, ne, notInArray } from 'drizzle-orm'
import type { InvoiceInput, LineInput, MessageInput } from '../../shared/billing'
import { addDays, type IsoDate } from '../../shared/dates'
import type { PaymentMethod } from '../../shared/domain'
import { type Actor, actorId } from '../access/actor'
import { can, ownId, requirePermission, requireRecord } from '../access/decisions'
import { readFacts } from '../access/facts'
import { invalidInput } from '../api/input'
import {
  allocateNumber, changeInvoiceLines, deleteInvoice, type Invoice, lockInvoice, recalculateInvoice, recordPaymentIn, recordRefund, removePaymentIn, retireNumber,
} from '../billing'
import type { AppContext } from '../context'
import { type Db, runTransaction, sumExact, type Tx } from '../db'
import {
  clients, expenseReceipts, files, invoiceAttachments, invoiceExpenses, invoiceLines, invoiceLinks, invoiceMessages, invoices, invoiceWriteOffs, payments, retainerEntries,
  retainers, retiredNumbers,
} from '../db/schema'
import { linkPlaceholder } from '../email/sender'
import { ApiError, NotFoundError, StaleError } from '../errors'
import { getSettings } from '../people/lookup'
import { cleanImage, ImageError } from '../people/image'
import { holdClient, logChange } from './common'
import {
  checkLines, checkMessage, checkTerms, clientLink, contactsOf, dueDate, fillIn, lineValues, makeLink, type MessageKey, messageWording, sendToClients,
} from './documents'
import { notify } from './notify'
import { formatDate, formatMoney } from './text'
import { todayOf } from './time'

async function requireInvoice(db: Db | Tx, actor: Actor, id: number, action?: 'payments.manage') {
  requireRecord(actor, { view: 'invoices.manage', ...(action && { action }) }, await readFacts(db, 'invoice', id), id)
}

async function lockVersion(tx: Tx, id: number, version: number): Promise<Invoice> {
  const invoice = await lockInvoice(tx, id)
  if (invoice.version !== version) throw new StaleError(id, version)
  return invoice
}

const dueOf = ({ issuedOn, paymentTerms, dueOn }: Pick<InvoiceInput, 'issuedOn' | 'paymentTerms' | 'dueOn'>): IsoDate => {
  const due = paymentTerms === 'custom' ? dueOn : dueDate(issuedOn, paymentTerms, null)
  if (due < issuedOn) throw invalidInput({ dueOn: 'The invoice cannot be due before it is issued.' })
  return due
}

async function takeNumber(tx: Tx, wanted: string, except: number | null): Promise<string> {
  if (wanted === '') return allocateNumber(tx, 'invoice')
  const [taken] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.number, wanted), ne(invoices.id, except ?? 0)))
  const [retired] = await tx.select().from(retiredNumbers).where(and(eq(retiredNumbers.kind, 'invoice'), eq(retiredNumbers.number, wanted)))
  if (taken || retired) throw invalidInput({ number: 'This number is already used.' })
  return wanted
}

/** A draft of lines that were typed. */
export async function createFreeInvoice(ctx: AppContext, actor: Actor, input: InvoiceInput): Promise<number> {
  requirePermission(actor, 'invoices.manage')
  return runTransaction(ctx.db, async (tx) => {
    const client = await holdClient(tx, input.clientId, 'use')
    if (!can(actor, 'clients.view', { type: 'client', clientId: client.id })) throw invalidInput({ clientId: 'Choose a client from the list.' })
    await checkLines(tx, actor, 'invoices.manage', client.id, input.lines)
    const number = await takeNumber(tx, input.number, null)
    const [invoice] = await tx
      .insert(invoices)
      .values({
        ...checkTerms(input), clientId: client.id, currency: client.currency, number, issuedOn: input.issuedOn, dueOn: dueOf(input), paymentTerms: input.paymentTerms, createdBy: ownId(actor),
      })
      .returning()
    if (!invoice) throw new Error('The invoice was not stored.')
    if (input.lines.length > 0) await tx.insert(invoiceLines).values(lineValues(input.lines).map((line) => ({ ...line, invoiceId: invoice.id, kind: 'manual' as const })))
    await recalculateInvoice(tx, invoice)
    await logChange(tx, actor, { action: 'created', type: 'invoice', id: invoice.id, summary: `Created invoice ${number}` })
    return invoice.id
  })
}

/** Lines of time and expenses keep what they bill; taking one away lets it be billed again. */
async function saveLines(tx: Tx, invoice: Invoice, lines: readonly LineInput[]): Promise<void> {
  const before = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id))
  const kept = lines.flatMap(({ id }) => (id === null ? [] : [id]))
  if (new Set(kept).size < kept.length || !kept.every((id) => before.some((line) => line.id === id))) throw new StaleError(invoice.id, invoice.version)
  const gone = before.filter(({ id }) => !kept.includes(id))
  if (gone.length > 0) {
    const goneIds = gone.map(({ id }) => id)
    const receipts = await tx
      .select({ id: expenseReceipts.fileId })
      .from(expenseReceipts)
      .innerJoin(invoiceExpenses, eq(invoiceExpenses.expenseId, expenseReceipts.expenseId))
      .where(inArray(invoiceExpenses.lineId, goneIds))
    if (receipts.length > 0) {
      await tx.delete(invoiceAttachments).where(and(eq(invoiceAttachments.invoiceId, invoice.id), inArray(invoiceAttachments.fileId, receipts.map(({ id }) => id))))
    }
    await tx.delete(invoiceLines).where(inArray(invoiceLines.id, goneIds))
  }
  for (const [index, { id, ...line }] of lineValues(lines).map((values, at) => ({ ...values, id: lines[at]?.id ?? null })).entries()) {
    const old = before.find((one) => one.id === id)
    if (!old) await tx.insert(invoiceLines).values({ ...line, invoiceId: invoice.id, kind: 'manual' })
    else if (old.kind === 'time' || old.kind === 'expense') {
      const { description, categoryId, tax1, tax2 } = line
      await tx.update(invoiceLines).set({ description, categoryId, tax1, tax2, position: index + 1 }).where(eq(invoiceLines.id, old.id))
    } else await tx.update(invoiceLines).set(line).where(eq(invoiceLines.id, old.id))
  }
}

export async function updateInvoice(ctx: AppContext, actor: Actor, id: number, { version, ...input }: InvoiceInput & { version: number }): Promise<void> {
  await requireInvoice(ctx.db, actor, id)
  await runTransaction(ctx.db, async (tx) => {
    const [seen] = await tx.select({ clientId: invoices.clientId }).from(invoices).where(eq(invoices.id, id))
    if (!seen) throw new NotFoundError(id)
    if (seen.clientId !== input.clientId) throw invalidInput({ clientId: 'The client of an invoice cannot be changed.' })
    await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, seen.clientId)).for('share')
    const known = (await tx.select({ projectId: invoiceLines.projectId }).from(invoiceLines).where(eq(invoiceLines.invoiceId, id))).map(({ projectId }) => projectId)
    await checkLines(tx, actor, 'invoices.manage', seen.clientId, input.lines, known)
    const after = await changeInvoiceLines(tx, id, async (invoice) => {
      if (invoice.version !== version) throw new StaleError(id, version)
      const number = await takeNumber(tx, input.number || invoice.number, id)
      if (number !== invoice.number) await retireNumber(tx, 'invoice', invoice.number)
      const values = { ...checkTerms(input), number, issuedOn: input.issuedOn, dueOn: dueOf(input), paymentTerms: input.paymentTerms }
      await tx.update(invoices).set(values).where(eq(invoices.id, id))
      Object.assign(invoice, values)
      await saveLines(tx, invoice, input.lines)
    })
    await logChange(tx, actor, { action: 'updated', type: 'invoice', id, summary: `Changed invoice ${after.number}` })
  })
}

/** A new draft with the same lines as typed ones. The hours and expenses stay on the old one. */
export async function duplicateInvoice(ctx: AppContext, actor: Actor, id: number): Promise<number> {
  await requireInvoice(ctx.db, actor, id)
  const issuedOn = await todayOf(ctx.db, ownId(actor), ctx.now())
  return runTransaction(ctx.db, async (tx) => {
    const [old] = await tx.select().from(invoices).where(eq(invoices.id, id))
    if (!old) throw new NotFoundError(id)
    const client = await holdClient(tx, old.clientId, 'use')
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(invoiceLines.position, invoiceLines.id)
    const number = await allocateNumber(tx, 'invoice')
    const { subject, purchaseOrder, notes, currency, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent, paymentTerms } = old
    const days = Math.max(0, Math.round((Date.parse(old.dueOn) - Date.parse(old.issuedOn)) / 86_400_000))
    const [invoice] = await tx
      .insert(invoices)
      .values({
        clientId: client.id, subject, purchaseOrder, notes, currency, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent, paymentTerms, number, issuedOn,
        dueOn: addDays(issuedOn, days), createdBy: ownId(actor),
      })
      .returning()
    if (!invoice) throw new Error('The invoice was not stored.')
    if (lines.length > 0) {
      await tx.insert(invoiceLines).values(
        lines.map(({ description, quantity, unitPrice, amount, projectId, categoryId, tax1, tax2, position }) => ({
          description, quantity, unitPrice, amount, projectId, categoryId, tax1, tax2, position, invoiceId: invoice.id, kind: 'manual' as const,
        })),
      )
    }
    await recalculateInvoice(tx, invoice)
    await logChange(tx, actor, { action: 'created', type: 'invoice', id: invoice.id, summary: `Duplicated invoice ${old.number} as ${number}` })
    return invoice.id
  })
}

/** Deletes an invoice without payments; its time and expenses can be billed again. */
export async function removeInvoice(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  const { db } = ctx
  await requireInvoice(db, actor, id)
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id))
  if ((await db.$count(retainerEntries, eq(retainerEntries.invoiceId, id))) > 0) throw new ApiError(409, 'on_retainer', 'This invoice is noted on a retainer and cannot be deleted.')
  const attached = await db.select({ id: invoiceAttachments.fileId }).from(invoiceAttachments).where(eq(invoiceAttachments.invoiceId, id))
  await deleteInvoice(db, id, version)
  await runTransaction(db, async (tx) => {
    // What was attached and is not a receipt is not used any more.
    const receipts = tx.select({ id: expenseReceipts.fileId }).from(expenseReceipts)
    if (attached.length > 0) await tx.delete(files).where(and(inArray(files.id, attached.map((row) => row.id)), notInArray(files.id, receipts)))
    await logChange(tx, actor, { action: 'deleted', type: 'invoice', id, summary: `Deleted invoice ${invoice?.number ?? id}` })
  })
}

// States ---------------------------------------------------------------------------------------------

/** A draft becomes an open invoice, without sending anything. */
export async function markSent(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  await requireInvoice(ctx.db, actor, id)
  await runTransaction(ctx.db, async (tx) => {
    await openDraft(ctx, tx, await lockVersion(tx, id, version))
    await logChange(tx, actor, { action: 'sent', type: 'invoice', id, summary: 'Marked an invoice as sent' })
  })
}

async function openDraft(ctx: Pick<AppContext, 'now'>, tx: Tx, invoice: Invoice): Promise<Invoice> {
  if (invoice.status !== 'draft') throw new ApiError(409, 'not_a_draft', 'Only a draft can be marked as sent.')
  if ((await tx.$count(invoiceLines, eq(invoiceLines.invoiceId, invoice.id))) === 0) throw new ApiError(409, 'no_lines', 'Add at least one line first.')
  const [open] = await tx.update(invoices).set({ status: 'open', sentAt: ctx.now() }).where(eq(invoices.id, invoice.id)).returning()
  if (!open) throw new NotFoundError(invoice.id)
  return recalculateInvoice(tx, open)
}

/** An open invoice without payments becomes a draft again. */
export async function backToDraft(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  await requireInvoice(ctx.db, actor, id)
  await runTransaction(ctx.db, async (tx) => {
    const invoice = await lockVersion(tx, id, version)
    const paid = await tx.$count(payments, eq(payments.invoiceId, id))
    if (invoice.status !== 'open' || paid > 0) throw new ApiError(409, 'not_open', 'Only an open invoice without payments can become a draft again.')
    await tx.update(invoices).set({ status: 'draft', sentAt: null }).where(eq(invoices.id, id))
    await revoke(ctx, tx, id)
    await logChange(tx, actor, { action: 'updated', type: 'invoice', id, summary: `Made invoice ${invoice.number} a draft again` })
  })
}

/** Gives up on what is still due. */
export async function writeOff(ctx: AppContext, actor: Actor, id: number, version: number, reason: string): Promise<void> {
  await requireInvoice(ctx.db, actor, id, 'payments.manage')
  const today = await todayOf(ctx.db, ownId(actor), ctx.now())
  await runTransaction(ctx.db, async (tx) => {
    const invoice = await lockVersion(tx, id, version)
    if (invoice.status !== 'open') throw new ApiError(409, 'not_open', 'Only an open invoice can be written off.')
    await tx.insert(invoiceWriteOffs).values({ invoiceId: id, amount: invoice.dueAmount, writtenOffOn: today, reason, recordedBy: actorId(actor) })
    await tx.update(invoices).set({ status: 'closed', closedOn: today }).where(eq(invoices.id, id))
    await logChange(tx, actor, { action: 'closed', type: 'invoice', id, summary: `Wrote off invoice ${invoice.number}`, changes: { amount: invoice.dueAmount } })
  })
}

/** Takes a write-off back. */
export async function reopen(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  await requireInvoice(ctx.db, actor, id, 'payments.manage')
  await runTransaction(ctx.db, async (tx) => {
    const invoice = await lockVersion(tx, id, version)
    if (invoice.status !== 'closed') throw new ApiError(409, 'not_closed', 'This invoice is not closed.')
    await tx.delete(invoiceWriteOffs).where(eq(invoiceWriteOffs.invoiceId, id))
    const [open] = await tx.update(invoices).set({ status: 'open', closedOn: null }).where(eq(invoices.id, id)).returning()
    if (open) await recalculateInvoice(tx, open)
    await logChange(tx, actor, { action: 'updated', type: 'invoice', id, summary: `Reopened invoice ${invoice.number}` })
  })
}

// Sending --------------------------------------------------------------------------------------------

const wordingOf = { sent: 'invoice', reminder: 'invoice_reminder', thank_you: 'invoice_thank_you' } as const satisfies Record<string, MessageKey>

export async function invoiceValues(db: Db, invoice: Invoice) {
  const { name } = await getSettings(db)
  return {
    number: invoice.number, amount: formatMoney(invoice.total, invoice.currency), open: formatMoney(invoice.dueAmount, invoice.currency), due: formatDate(invoice.dueOn), company: name,
    subject: invoice.subject,
  }
}

/** What a message could say, and who it could go to. */
export async function draftMessage(ctx: AppContext, actor: Actor, id: number, kind: keyof typeof wordingOf): Promise<Omit<MessageInput, 'kind'>> {
  await requireInvoice(ctx.db, actor, id)
  const [invoice] = await ctx.db.select().from(invoices).where(eq(invoices.id, id))
  if (!invoice) throw new NotFoundError(id)
  return defaultMessage(ctx.db, invoice, kind)
}

export async function defaultMessage(db: Db, invoice: Invoice, kind: keyof typeof wordingOf): Promise<Omit<MessageInput, 'kind'>> {
  const wording = await messageWording(db, wordingOf[kind])
  const values = await invoiceValues(db, invoice)
  // Who had it before, or the client's contacts.
  const sent = await db.select().from(invoiceMessages).where(and(eq(invoiceMessages.invoiceId, invoice.id), eq(invoiceMessages.kind, 'sent'))).orderBy(invoiceMessages.id)
  const recipients = sent.at(-1)?.recipients ?? (await contactsOf(db, invoice.clientId))
  return { recipients, subject: fillIn(wording.subject, values), body: fillIn(wording.body, values) }
}

/** Sends a message about an invoice, or keeps a note. Sending a draft opens it. */
export async function sendMessage(ctx: AppContext, actor: Actor | null, id: number, version: number | null, message: MessageInput): Promise<void> {
  if (actor) await requireInvoice(ctx.db, actor, id)
  checkMessage(message)
  const senderId = actor ? ownId(actor) : null
  const { token, tokenHash } = makeLink()
  const linked = message.kind !== 'note' && message.body.includes(linkPlaceholder)
  await runTransaction(ctx.db, async (tx) => {
    const invoice = await lockInvoice(tx, id)
    if (version !== null && invoice.version !== version) throw new StaleError(id, version)
    if (message.kind === 'sent' && invoice.status === 'draft') await openDraft(ctx, tx, invoice)
    else if (invoice.status === 'draft' && message.kind !== 'note') throw new ApiError(409, 'is_draft', 'Send the invoice first.')
    if (linked) await tx.insert(invoiceLinks).values({ invoiceId: id, tokenHash, createdBy: senderId })
    await tx.insert(invoiceMessages).values({ invoiceId: id, kind: message.kind, senderId, recipients: message.recipients, subject: message.subject, body: message.body })
    if (actor) await logChange(tx, actor, { action: 'sent', type: 'invoice', id, summary: `${message.kind === 'note' ? 'Noted something on' : 'Sent a message about'} invoice ${invoice.number}` })
  })
  if (message.kind !== 'note') await sendToClients(ctx, message, { type: 'invoice', id }, linked ? clientLink(ctx, 'invoice', token) : undefined, senderId ?? undefined)
}

export async function createLink(ctx: AppContext, actor: Actor, id: number): Promise<string> {
  await requireInvoice(ctx.db, actor, id)
  const { token, tokenHash } = makeLink()
  await runTransaction(ctx.db, async (tx) => {
    const invoice = await lockInvoice(tx, id)
    if (invoice.status === 'draft') throw new ApiError(409, 'is_draft', 'A draft has no link. Send it, or mark it as sent, first.')
    await tx.insert(invoiceLinks).values({ invoiceId: id, tokenHash, createdBy: ownId(actor) })
    await logChange(tx, actor, { action: 'created', type: 'invoice', id, summary: `Made a client link of invoice ${invoice.number}` })
  })
  return clientLink(ctx, 'invoice', token)
}

const revoke = (ctx: Pick<AppContext, 'now'>, tx: Tx, id: number) => tx.update(invoiceLinks).set({ revokedAt: ctx.now() }).where(and(eq(invoiceLinks.invoiceId, id), isNull(invoiceLinks.revokedAt)))

export async function revokeLinks(ctx: AppContext, actor: Actor, id: number): Promise<void> {
  await requireInvoice(ctx.db, actor, id)
  await runTransaction(ctx.db, async (tx) => {
    const invoice = await lockInvoice(tx, id)
    await revoke(ctx, tx, id)
    await logChange(tx, actor, { action: 'updated', type: 'invoice', id, summary: `Revoked the client links of invoice ${invoice.number}` })
  })
}

// Attachments -----------------------------------------------------------------------------------------

export const attachmentBytes = 5 * 1024 * 1024
const mostAttachments = 20

/** Attaches the receipts of the expenses on it. */
export async function attachReceipts(ctx: AppContext, actor: Actor, id: number): Promise<void> {
  await requireInvoice(ctx.db, actor, id)
  await runTransaction(ctx.db, async (tx) => {
    await lockInvoice(tx, id)
    const receipts = await tx
      .select({ id: expenseReceipts.fileId })
      .from(expenseReceipts)
      .innerJoin(invoiceExpenses, eq(invoiceExpenses.expenseId, expenseReceipts.expenseId))
      .innerJoin(invoiceLines, eq(invoiceLines.id, invoiceExpenses.lineId))
      .where(eq(invoiceLines.invoiceId, id))
    if (receipts.length > 0) await tx.insert(invoiceAttachments).values(receipts.map(({ id: fileId }) => ({ invoiceId: id, fileId }))).onConflictDoNothing()
  })
}

export async function attachFile(ctx: AppContext, actor: Actor, id: number, name: string, upload: Buffer): Promise<void> {
  await requireInvoice(ctx.db, actor, id)
  const { mediaType, content } = readAttachment(upload)
  await runTransaction(ctx.db, async (tx) => {
    await lockInvoice(tx, id)
    if ((await tx.$count(invoiceAttachments, eq(invoiceAttachments.invoiceId, id))) >= mostAttachments) throw new ApiError(409, 'too_many', `An invoice can have ${mostAttachments} attachments.`)
    const safe = name.replace(/[^\w. -]/g, '').slice(-80) || 'attachment'
    const [file] = await tx.insert(files).values({ name: safe, mediaType, content, sizeBytes: content.length, ownerId: ownId(actor) }).returning({ id: files.id })
    if (file) await tx.insert(invoiceAttachments).values({ invoiceId: id, fileId: file.id })
  })
}

function readAttachment(upload: Buffer) {
  if (upload.subarray(0, 5).toString('latin1') === '%PDF-') return { mediaType: 'application/pdf', content: upload }
  try {
    return cleanImage(upload)
  } catch (error) {
    if (error instanceof ImageError) throw new ApiError(400, 'bad_file', 'Choose a PNG or JPEG picture, or a PDF.')
    throw error
  }
}

export async function detachFile(ctx: AppContext, actor: Actor, id: number, fileId: number): Promise<void> {
  await requireInvoice(ctx.db, actor, id)
  await runTransaction(ctx.db, async (tx) => {
    await lockInvoice(tx, id)
    const [gone] = await tx.delete(invoiceAttachments).where(and(eq(invoiceAttachments.invoiceId, id), eq(invoiceAttachments.fileId, fileId))).returning()
    if (!gone) throw new NotFoundError(fileId)
    if ((await tx.$count(expenseReceipts, eq(expenseReceipts.fileId, fileId))) === 0) await tx.delete(files).where(eq(files.id, fileId))
  })
}

export async function readAttachedFile(db: Db, actor: Actor, id: number, fileId: number) {
  await requireInvoice(db, actor, id)
  const [file] = await db.select({ file: files }).from(invoiceAttachments).innerJoin(files, eq(files.id, invoiceAttachments.fileId)).where(and(eq(invoiceAttachments.invoiceId, id), eq(invoiceAttachments.fileId, fileId)))
  if (!file) throw new NotFoundError(fileId)
  return file.file
}

// Money ------------------------------------------------------------------------------------------------

export interface PaymentInput {
  amount: number
  paidOn: IsoDate
  method: Exclude<PaymentMethod, 'online' | 'retainer'>
  reference: string
  notes: string
}

/** Money that came in some other way: nothing is charged here. */
export async function addPayment(ctx: AppContext, actor: Actor, id: number, input: PaymentInput): Promise<void> {
  await requireInvoice(ctx.db, actor, id, 'payments.manage')
  const invoice = await runTransaction(ctx.db, async (tx) => {
    const result = await recordPaymentIn(tx, { invoiceId: id, ...input, recordedBy: actorId(actor) })
    await logChange(tx, actor, { action: 'paid', type: 'invoice', id, summary: `Recorded a payment of invoice ${result.invoice.number}`, changes: { amount: input.amount } })
    return result.invoice
  })
  await tellPaid(ctx, invoice, input.amount, actorId(actor))
}

export async function tellPaid(ctx: AppContext, invoice: Invoice, amount: number, except: number | null): Promise<void> {
  if (invoice.createdBy === except) return
  await notify(ctx, [invoice.createdBy], {
    kind: 'invoice_paid', title: `Payment for invoice ${invoice.number}`, path: `/invoices/${invoice.id}`,
    body: `${formatMoney(amount, invoice.currency)} came in. ${invoice.dueAmount > 0 ? `${formatMoney(invoice.dueAmount, invoice.currency)} is still due.` : 'It is paid in full.'}`,
  })
}

/** Pays from money the client paid in advance. */
export async function payFromRetainer(ctx: AppContext, actor: Actor, id: number, retainerId: number, amount: number): Promise<void> {
  await requireInvoice(ctx.db, actor, id, 'payments.manage')
  const today = await todayOf(ctx.db, ownId(actor), ctx.now())
  await runTransaction(ctx.db, async (tx) => {
    // The retainer before the invoice, as in src/server/billing/claim.ts.
    const [retainer] = await tx.select().from(retainers).where(eq(retainers.id, retainerId)).for('update')
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, id))
    if (!retainer || !invoice || retainer.clientId !== invoice.clientId || retainer.currency !== invoice.currency || retainer.status !== 'active') {
      throw invalidInput({ retainerId: 'Choose a retainer of this client.' })
    }
    const [sum] = await tx.select({ balance: sumExact(retainerEntries.amount) }).from(retainerEntries).where(eq(retainerEntries.retainerId, retainerId))
    if (amount > (sum?.balance ?? 0)) throw invalidInput({ amount: 'There is not that much left on the retainer.' })
    const { payment } = await recordPaymentIn(tx, { invoiceId: id, amount, paidOn: today, method: 'retainer', reference: retainer.name, recordedBy: actorId(actor) })
    await tx.insert(retainerEntries).values({ retainerId, kind: 'draw_down', amount: -amount, occurredOn: today, invoiceId: id, paymentId: payment.id, recordedBy: actorId(actor) })
    await logChange(tx, actor, { action: 'paid', type: 'invoice', id, summary: `Paid invoice ${invoice.number} from a retainer`, changes: { amount } })
  })
}

async function paymentOf(db: Db, id: number, paymentId: number) {
  const [payment] = await db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.invoiceId, id)))
  if (!payment) throw new NotFoundError(paymentId)
  return payment
}

/** Takes back a payment recorded by mistake. What came from a retainer goes back to it. */
export async function removePayment(ctx: AppContext, actor: Actor, id: number, paymentId: number): Promise<void> {
  await requireInvoice(ctx.db, actor, id, 'payments.manage')
  const seen = await paymentOf(ctx.db, id, paymentId)
  if (seen.method === 'online' && seen.provider !== 'simulated') throw new ApiError(409, 'online_payment', 'An online payment cannot be taken back here. Refund it instead.')
  const today = await todayOf(ctx.db, ownId(actor), ctx.now())
  await runTransaction(ctx.db, async (tx) => {
    const [drawn] = await tx.select().from(retainerEntries).where(eq(retainerEntries.paymentId, paymentId))
    if (drawn) {
      await tx.select({ id: retainers.id }).from(retainers).where(eq(retainers.id, drawn.retainerId)).for('update')
      await tx.update(retainerEntries).set({ paymentId: null }).where(eq(retainerEntries.id, drawn.id))
      await tx.insert(retainerEntries).values({ retainerId: drawn.retainerId, kind: 'adjustment', amount: -drawn.amount, occurredOn: today, invoiceId: id, notes: 'The payment was taken back.', recordedBy: actorId(actor) })
    }
    const { payment, invoice } = await removePaymentIn(tx, paymentId)
    await logChange(tx, actor, { action: 'deleted', type: 'invoice', id, summary: `Took back a payment of invoice ${invoice.number}`, changes: { amount: payment.amount } })
  })
}

export async function refundPayment(ctx: AppContext, actor: Actor, id: number, paymentId: number, input: { amount: number; refundedOn: IsoDate; reason: string }): Promise<void> {
  await requireInvoice(ctx.db, actor, id, 'payments.manage')
  const payment = await paymentOf(ctx.db, id, paymentId)
  if (payment.method === 'retainer') throw new ApiError(409, 'retainer_payment', 'Take the payment back instead: the money goes back to the retainer.')
  await recordRefund(ctx.db, { paymentId, ...input, recordedBy: actorId(actor) })
  await runTransaction(ctx.db, (tx) => logChange(tx, actor, { action: 'updated', type: 'invoice', id, summary: 'Recorded a refund', changes: { amount: input.amount } }))
}

