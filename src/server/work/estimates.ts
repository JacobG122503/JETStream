/** Estimates: what work would cost, for a client to accept or decline. */
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm'
import type { ClientEstimate, EstimateDetails, EstimateInput, EstimateRow, MessageInput, PrintedDocument } from '../../shared/billing'
import { documentTotals } from '../../shared/calc'
import { addDays, type IsoDate } from '../../shared/dates'
import type { Actor } from '../access/actor'
import { can, holds, ownId, requirePermission, requireRecord } from '../access/decisions'
import { readFacts } from '../access/facts'
import { filterFor } from '../access/filters'
import { invalidInput } from '../api/input'
import { allocateNumber, recalculateInvoice, retireNumber } from '../billing'
import { todayIn } from '../clock'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx, updateVersioned } from '../db'
import {
  clients, estimateAnswerRecords, estimateLines, estimateLinks, estimateMessages, estimates, invoiceLines, invoices, projects, retiredNumbers, tasks,
} from '../db/schema'
import { linkPlaceholder } from '../email/sender'
import { ApiError, NotFoundError, StaleError } from '../errors'
import { getSettings } from '../people/lookup'
import { linkInvalid } from '../people/links'
import { holdClient, logChange } from './common'
import {
  checkLines, checkMessage, checkTerms, clientLink, companyHead, contactsOf, dueDate, fillIn, lineValues, linkHash, makeLink, messageWording, sendToClients, toLinks, toMessages,
} from './documents'
import { notify } from './notify'
import { createProject } from './projects'
import { formatDate, formatMoney } from './text'
import { todayOf } from './time'

type Estimate = typeof estimates.$inferSelect
type Client = typeof clients.$inferSelect

const toRow = (estimate: Estimate, client: Client, today: IsoDate): EstimateRow => ({
  id: estimate.id, name: estimate.number, number: estimate.number, client: { id: client.id, name: client.name }, subject: estimate.subject, status: estimate.status,
  expired: estimate.status === 'sent' && estimate.expiresOn !== null && estimate.expiresOn < today, issuedOn: estimate.issuedOn, expiresOn: estimate.expiresOn,
  currency: estimate.currency, total: estimate.total,
})

export async function listEstimates(ctx: AppContext, actor: Actor): Promise<{ estimates: EstimateRow[] }> {
  requirePermission(actor, 'estimates.manage')
  const today = await todayOf(ctx.db, ownId(actor), ctx.now())
  const rows = await ctx.db
    .select({ estimate: estimates, client: clients })
    .from(estimates)
    .innerJoin(clients, eq(clients.id, estimates.clientId))
    .where(filterFor(ctx.db, actor, 'estimates.manage', 'estimate'))
    .orderBy(desc(estimates.issuedOn), desc(estimates.id))
  return { estimates: rows.map(({ estimate, client }) => toRow(estimate, client, today)) }
}

async function print(db: Db, estimate: Estimate, client: Client): Promise<PrintedDocument> {
  const lines = await db.select().from(estimateLines).where(eq(estimateLines.estimateId, estimate.id)).orderBy(asc(estimateLines.position), asc(estimateLines.id))
  const { number, currency, subject, purchaseOrder, notes, issuedOn, subtotal, discountPercent, discountAmount, tax1Name, tax1Percent, tax1Amount, tax2Name, tax2Percent, tax2Amount, total } = estimate
  return {
    number, currency, subject, purchaseOrder, notes, issuedOn, subtotal, discountPercent, discountAmount, tax1Name, tax1Percent, tax1Amount, tax2Name, tax2Percent, tax2Amount, total,
    company: await companyHead(db), clientName: client.name, clientAddress: client.address,
    lines: lines.map(({ id, description, quantity, unitPrice, amount, projectId, categoryId, tax1, tax2 }) => ({ id, description, quantity, unitPrice, amount, projectId, categoryId, tax1, tax2, kind: 'manual', minutes: null })),
  }
}

async function requireEstimate(db: Db | Tx, actor: Actor, id: number) {
  requireRecord(actor, { view: 'estimates.manage' }, await readFacts(db, 'estimate', id), id)
}

async function loadOne(db: Db, id: number) {
  const [row] = await db.select({ estimate: estimates, client: clients }).from(estimates).innerJoin(clients, eq(clients.id, estimates.clientId)).where(eq(estimates.id, id))
  if (!row) throw new NotFoundError(id)
  return row
}

export async function readEstimate(ctx: AppContext, actor: Actor, id: number): Promise<EstimateDetails> {
  const { db } = ctx
  await requireEstimate(db, actor, id)
  const { estimate, client } = await loadOne(db, id)
  const answers = await db.select().from(estimateAnswerRecords).where(eq(estimateAnswerRecords.estimateId, id)).orderBy(desc(estimateAnswerRecords.id))
  const messages = await db.select().from(estimateMessages).where(eq(estimateMessages.estimateId, id)).orderBy(desc(estimateMessages.id))
  const links = await db.select().from(estimateLinks).where(eq(estimateLinks.estimateId, id)).orderBy(desc(estimateLinks.id))
  const [invoice] = estimate.invoiceId === null ? [] : await db.select().from(invoices).where(eq(invoices.id, estimate.invoiceId))
  const [project] = estimate.projectId === null ? [] : await db.select().from(projects).where(eq(projects.id, estimate.projectId))
  return {
    ...(await print(db, estimate, client)),
    ...toRow(estimate, client, await todayOf(db, ownId(actor), ctx.now())),
    version: estimate.version,
    messages: await toMessages(db, messages),
    links: toLinks(links),
    answers: answers.map(({ id: answerId, answer, name, comment, answeredAt, linkId, recordedBy }) => ({ id: answerId, answer, name, comment, at: answeredAt.toISOString(), byClient: linkId !== null || recordedBy === null })),
    contacts: await contactsOf(db, client.id),
    invoice: invoice ? { id: invoice.id, number: invoice.number } : null,
    project: project ? { id: project.id, name: project.name } : null,
    canInvoice: holds(actor, 'invoices.manage') && estimate.invoiceId === null && client.archivedAt === null,
    canCreateProject: holds(actor, 'projects.create') && estimate.projectId === null && client.archivedAt === null,
  }
}

async function takeNumber(tx: Tx, wanted: string, except: number): Promise<string> {
  if (wanted === '') return allocateNumber(tx, 'estimate')
  const [taken] = await tx.select({ id: estimates.id }).from(estimates).where(and(eq(estimates.number, wanted), ne(estimates.id, except)))
  const [retired] = await tx.select().from(retiredNumbers).where(and(eq(retiredNumbers.kind, 'estimate'), eq(retiredNumbers.number, wanted)))
  if (taken || retired) throw invalidInput({ number: 'This number is already used.' })
  return wanted
}

function valuesOf(input: EstimateInput) {
  if (input.expiresOn !== null && input.expiresOn < input.issuedOn) throw invalidInput({ expiresOn: 'It cannot expire before it is issued.' })
  const { subtotal, discount, tax1, tax2, total } = documentTotals(input.lines, input)
  if (total < 0) throw invalidInput({ lines: 'The total cannot be below 0.' })
  return {
    ...checkTerms(input), issuedOn: input.issuedOn, expiresOn: input.expiresOn, subtotal, discountAmount: discount, tax1Amount: tax1, tax2Amount: tax2, total,
  }
}

const storeLines = async (tx: Tx, id: number, input: EstimateInput) => {
  if (input.lines.length > 0) await tx.insert(estimateLines).values(lineValues(input.lines).map((line) => ({ ...line, estimateId: id })))
}

export async function createEstimate(ctx: AppContext, actor: Actor, input: EstimateInput): Promise<number> {
  requirePermission(actor, 'estimates.manage')
  const values = valuesOf(input)
  return runTransaction(ctx.db, async (tx) => {
    const client = await holdClient(tx, input.clientId, 'use')
    if (!can(actor, 'clients.view', { type: 'client', clientId: client.id })) throw invalidInput({ clientId: 'Choose a client from the list.' })
    await checkLines(tx, actor, 'estimates.manage', client.id, input.lines)
    const number = await takeNumber(tx, input.number, 0)
    const [row] = await tx.insert(estimates).values({ ...values, number, clientId: client.id, currency: client.currency, createdBy: ownId(actor) }).returning()
    if (!row) throw new Error('The estimate was not stored.')
    await storeLines(tx, row.id, input)
    await logChange(tx, actor, { action: 'created', type: 'estimate', id: row.id, summary: `Created estimate ${number}` })
    return row.id
  })
}

/** Changing one that was answered takes the answer back: it was for something else. */
export async function updateEstimate(ctx: AppContext, actor: Actor, id: number, { version, ...input }: EstimateInput & { version: number }): Promise<void> {
  const values = valuesOf(input)
  await requireEstimate(ctx.db, actor, id)
  await runTransaction(ctx.db, async (tx) => {
    const [old] = await tx.select().from(estimates).where(eq(estimates.id, id))
    if (!old) throw new NotFoundError(id)
    if (old.clientId !== input.clientId) throw invalidInput({ clientId: 'The client of an estimate cannot be changed.' })
    await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, old.clientId)).for('share')
    const known = (await tx.select({ projectId: estimateLines.projectId }).from(estimateLines).where(eq(estimateLines.estimateId, id))).map(({ projectId }) => projectId)
    await checkLines(tx, actor, 'estimates.manage', old.clientId, input.lines, known)
    const number = await takeNumber(tx, input.number || old.number, id)
    if (number !== old.number) await retireNumber(tx, 'estimate', old.number)
    const status = old.status === 'draft' ? 'draft' : 'sent'
    await updateVersioned(tx, estimates, id, version, { ...values, number, status })
    await tx.delete(estimateLines).where(eq(estimateLines.estimateId, id))
    await storeLines(tx, id, input)
    await logChange(tx, actor, { action: 'updated', type: 'estimate', id, summary: `Changed estimate ${number}` })
  })
}

async function lockEstimate(tx: Tx, id: number, version?: number): Promise<Estimate> {
  const [row] = await tx.select().from(estimates).where(eq(estimates.id, id)).for('update')
  if (!row) throw new NotFoundError(id)
  if (version !== undefined && row.version !== version) throw new StaleError(id, version)
  return row
}

export async function deleteEstimate(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  await requireEstimate(ctx.db, actor, id)
  await runTransaction(ctx.db, async (tx) => {
    const { number } = await lockEstimate(tx, id, version)
    await retireNumber(tx, 'estimate', number)
    await tx.delete(estimates).where(eq(estimates.id, id))
    await logChange(tx, actor, { action: 'deleted', type: 'estimate', id, summary: `Deleted estimate ${number}` })
  })
}

export async function duplicateEstimate(ctx: AppContext, actor: Actor, id: number): Promise<number> {
  await requireEstimate(ctx.db, actor, id)
  const { estimate, client } = await loadOne(ctx.db, id)
  const { lines, ...printed } = await print(ctx.db, estimate, client)
  const issuedOn = await todayOf(ctx.db, ownId(actor), ctx.now())
  const { estimateValidDays } = await getSettings(ctx.db)
  return createEstimate(ctx, actor, {
    ...printed, clientId: client.id, number: '', issuedOn, expiresOn: addDays(issuedOn, estimateValidDays),
    lines: lines.map(({ description, quantity, unitPrice, projectId, categoryId, tax1, tax2 }) => ({ id: null, description, quantity, unitPrice, projectId, categoryId, tax1, tax2 })),
  })
}

// Sending and answers ------------------------------------------------------------------------------------

async function valuesFor(db: Db, estimate: Estimate) {
  const { name } = await getSettings(db)
  return { number: estimate.number, amount: formatMoney(estimate.total, estimate.currency), due: estimate.expiresOn === null ? '' : formatDate(estimate.expiresOn), company: name, subject: estimate.subject }
}

export async function draftEstimateMessage(ctx: AppContext, actor: Actor, id: number): Promise<Omit<MessageInput, 'kind'>> {
  await requireEstimate(ctx.db, actor, id)
  const { estimate, client } = await loadOne(ctx.db, id)
  const wording = await messageWording(ctx.db, 'estimate')
  const values = await valuesFor(ctx.db, estimate)
  return { recipients: await contactsOf(ctx.db, client.id), subject: fillIn(wording.subject, values), body: fillIn(wording.body, values) }
}

export async function sendEstimate(ctx: AppContext, actor: Actor, id: number, version: number, message: MessageInput): Promise<void> {
  await requireEstimate(ctx.db, actor, id)
  checkMessage(message)
  const { token, tokenHash } = makeLink()
  const linked = message.kind !== 'note' && message.body.includes(linkPlaceholder)
  await runTransaction(ctx.db, async (tx) => {
    const estimate = await lockEstimate(tx, id, version)
    if (message.kind !== 'note') await openEstimate(ctx, tx, estimate)
    if (linked) await tx.insert(estimateLinks).values({ estimateId: id, tokenHash, createdBy: ownId(actor) })
    await tx.insert(estimateMessages).values({ estimateId: id, kind: message.kind, senderId: ownId(actor), recipients: message.recipients, subject: message.subject, body: message.body })
    await logChange(tx, actor, { action: 'sent', type: 'estimate', id, summary: `${message.kind === 'note' ? 'Noted something on' : 'Sent'} estimate ${estimate.number}` })
  })
  if (message.kind !== 'note') await sendToClients(ctx, message, { type: 'estimate', id }, linked ? clientLink(ctx, 'estimate', token) : undefined, ownId(actor))
}

async function openEstimate(ctx: Pick<AppContext, 'now'>, tx: Tx, estimate: Estimate) {
  if (estimate.status !== 'draft') return
  if ((await tx.$count(estimateLines, eq(estimateLines.estimateId, estimate.id))) === 0) throw new ApiError(409, 'no_lines', 'Add at least one line first.')
  await tx.update(estimates).set({ status: 'sent', sentAt: ctx.now() }).where(eq(estimates.id, estimate.id))
}

export async function markEstimateSent(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  await requireEstimate(ctx.db, actor, id)
  await runTransaction(ctx.db, async (tx) => openEstimate(ctx, tx, await lockEstimate(tx, id, version)))
}

export async function createEstimateLink(ctx: AppContext, actor: Actor, id: number): Promise<string> {
  await requireEstimate(ctx.db, actor, id)
  const { token, tokenHash } = makeLink()
  await runTransaction(ctx.db, async (tx) => {
    const { status } = await lockEstimate(tx, id)
    if (status === 'draft') throw new ApiError(409, 'is_draft', 'A draft has no link. Send it, or mark it as sent, first.')
    await tx.insert(estimateLinks).values({ estimateId: id, tokenHash, createdBy: ownId(actor) })
  })
  return clientLink(ctx, 'estimate', token)
}

export async function revokeEstimateLinks(ctx: AppContext, actor: Actor, id: number): Promise<void> {
  await requireEstimate(ctx.db, actor, id)
  await ctx.db.update(estimateLinks).set({ revokedAt: ctx.now() }).where(and(eq(estimateLinks.estimateId, id), isNull(estimateLinks.revokedAt)))
}

export interface AnswerInput {
  answer: 'accepted' | 'declined'
  name: string
  comment: string
}

/** An answer that came some other way. */
export async function recordAnswer(ctx: AppContext, actor: Actor, id: number, version: number, input: AnswerInput): Promise<void> {
  await requireEstimate(ctx.db, actor, id)
  await runTransaction(ctx.db, async (tx) => {
    const estimate = await lockEstimate(tx, id, version)
    if (estimate.status === 'draft') throw new ApiError(409, 'is_draft', 'Send it, or mark it as sent, first.')
    await tx.update(estimates).set({ status: input.answer }).where(eq(estimates.id, id))
    await tx.insert(estimateAnswerRecords).values({ estimateId: id, ...input, recordedBy: ownId(actor) })
    await logChange(tx, actor, { action: 'updated', type: 'estimate', id, summary: `Recorded that estimate ${estimate.number} was ${input.answer}` })
  })
}

// What clients see -----------------------------------------------------------------------------------------

async function byLink(db: Db, token: unknown) {
  const [link] = await db.select().from(estimateLinks).where(and(eq(estimateLinks.tokenHash, linkHash(token)), isNull(estimateLinks.revokedAt)))
  if (!link) throw linkInvalid()
  const found = await loadOne(db, link.estimateId)
  if (found.estimate.status === 'draft') throw linkInvalid()
  return { link, ...found }
}

export async function readClientEstimate(ctx: AppContext, token: unknown): Promise<ClientEstimate> {
  const { db } = ctx
  const { link, estimate, client } = await byLink(db, token)
  await db.update(estimateLinks).set({ lastViewedAt: ctx.now() }).where(eq(estimateLinks.id, link.id))
  const [answer] = await db.select().from(estimateAnswerRecords).where(eq(estimateAnswerRecords.estimateId, estimate.id)).orderBy(desc(estimateAnswerRecords.id)).limit(1)
  const { status, expiresOn } = estimate
  if (status === 'draft') throw linkInvalid()
  const today = todayIn((await getSettings(db)).timeZone, ctx.now())
  return {
    ...(await print(db, estimate, client)), status, expiresOn, expired: status === 'sent' && expiresOn !== null && expiresOn < today,
    answer: status !== 'sent' && answer ? { answer: answer.answer, name: answer.name, comment: answer.comment } : null,
  }
}

export async function answerAsClient(ctx: AppContext, token: unknown, input: AnswerInput): Promise<ClientEstimate> {
  const { link, estimate, client } = await byLink(ctx.db, token)
  const today = todayIn((await getSettings(ctx.db)).timeZone, ctx.now())
  await runTransaction(ctx.db, async (tx) => {
    const now = await lockEstimate(tx, estimate.id)
    if (now.status !== 'sent') throw new ApiError(409, 'answered', 'This estimate was already answered.')
    if (now.expiresOn !== null && now.expiresOn < today) throw new ApiError(409, 'expired', 'This estimate has expired.')
    await tx.update(estimates).set({ status: input.answer }).where(eq(estimates.id, estimate.id))
    await tx.insert(estimateAnswerRecords).values({ estimateId: estimate.id, ...input, linkId: link.id })
  })
  await notify(ctx, [estimate.createdBy], {
    kind: 'estimate_answer', title: `Estimate ${estimate.number} was ${input.answer}`, body: `${input.name} of ${client.name} ${input.answer} it.${input.comment ? `\n\n${input.comment}` : ''}`, path: `/estimates/${estimate.id}`,
  })
  return readClientEstimate(ctx, token)
}

// What is made from it ---------------------------------------------------------------------------------------

/** A draft invoice with the estimate's lines. */
export async function invoiceFromEstimate(ctx: AppContext, actor: Actor, id: number, version: number): Promise<number> {
  await requireEstimate(ctx.db, actor, id)
  requirePermission(actor, 'invoices.manage')
  const issuedOn = await todayOf(ctx.db, ownId(actor), ctx.now())
  return runTransaction(ctx.db, async (tx) => {
    const [seen] = await tx.select({ clientId: estimates.clientId }).from(estimates).where(eq(estimates.id, id))
    if (!seen) throw new NotFoundError(id)
    const client = await holdClient(tx, seen.clientId, 'use')
    const number = await allocateNumber(tx, 'invoice')
    const estimate = await lockEstimate(tx, id, version)
    if (estimate.invoiceId !== null) throw new ApiError(409, 'has_invoice', 'An invoice was already made from it.')
    const lines = await tx.select().from(estimateLines).where(eq(estimateLines.estimateId, id)).orderBy(asc(estimateLines.position))
    const projectIds = lines.flatMap(({ projectId }) => (projectId === null ? [] : [projectId]))
    if (!can(actor, 'invoices.manage', { type: 'invoice', createdBy: ownId(actor), projectIds })) throw new ApiError(403, 'forbidden', 'You may not bill these projects.')
    const { subject, purchaseOrder, currency, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent } = estimate
    const { invoiceNotes } = await getSettings(tx)
    const [invoice] = await tx
      .insert(invoices)
      .values({
        clientId: client.id, subject, purchaseOrder, notes: invoiceNotes, currency, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent, number, issuedOn,
        dueOn: dueDate(issuedOn, client.paymentTerms, client.paymentTermDays), paymentTerms: client.paymentTerms, createdBy: ownId(actor),
      })
      .returning()
    if (!invoice) throw new Error('The invoice was not stored.')
    if (lines.length > 0) {
      await tx.insert(invoiceLines).values(lines.map(({ id: _id, estimateId: _estimate, ...line }) => ({ ...line, invoiceId: invoice.id, kind: 'manual' as const })))
    }
    await recalculateInvoice(tx, invoice)
    await tx.update(estimates).set({ invoiceId: invoice.id }).where(eq(estimates.id, id))
    await logChange(tx, actor, { action: 'created', type: 'invoice', id: invoice.id, summary: `Created invoice ${number} from estimate ${estimate.number}` })
    return invoice.id
  })
}

/** A project for the work, with the common tasks. */
export async function projectFromEstimate(ctx: AppContext, actor: Actor, id: number, version: number, name: string): Promise<number> {
  await requireEstimate(ctx.db, actor, id)
  const { estimate } = await loadOne(ctx.db, id)
  if (estimate.version !== version) throw new StaleError(id, version)
  if (estimate.projectId !== null) throw new ApiError(409, 'has_project', 'A project was already made from it.')
  const common = await ctx.db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.common, true), isNull(tasks.archivedAt)))
  const projectId = await createProject(ctx, actor, {
    clientId: estimate.clientId, name, code: '', type: 'time_materials', rate: null, fixedFee: null, budgetMinutes: null, taskIds: common.map((task) => task.id), personIds: [],
  })
  await ctx.db.update(estimates).set({ projectId }).where(eq(estimates.id, id))
  return projectId
}
