/** What invoices, estimates and recurring invoices have in common: lines, taxes, links and messages. */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { lineAmount } from '../../shared/calc'
import { addDays, type IsoDate } from '../../shared/dates'
import type { DocumentClient, DocumentOptions, DocumentTerms, LineInput, LinkRow, MessageInput, MessageRow, Recipient } from '../../shared/billing'
import type { PaymentTerms } from '../../shared/work'
import type { Actor } from '../access/actor'
import { can, forbidden, holds, ownId } from '../access/decisions'
import { filterFor } from '../access/filters'
import { date, invalidInput, listOf, newEmail, optional, optionalId, optionalText, percent, personName, signedMoney, text, flag, oneOf, id as anId, whole } from '../api/input'
import { hashToken, isToken, newToken } from '../auth/tokens'
import type { AppContext } from '../context'
import type { Db, Tx } from '../db'
import { clients, contacts, files, itemCategories, messageTemplates, people, projects } from '../db/schema'
import { sendEmail } from '../email/sender'
import { getSettings } from '../people/lookup'
import { linkInvalid } from '../people/links'
import { holdProject } from './common'
import { todayOf } from './time'

// What is read from a request ----------------------------------------------------------------------

const termNames = ['upon_receipt', 'net_15', 'net_30', 'net_45', 'net_60', 'custom'] as const
const mostQuantity = 1_000_000_000

export const termReaders = {
  subject: text(200), purchaseOrder: text(60), notes: text(4000), discountPercent: optional(percent), tax1Name: optionalText(40), tax1Percent: optional(percent),
  tax2Name: optionalText(40), tax2Percent: optional(percent),
}

export const linesReader = listOf(
  {
    id: optionalId, description: text(2000), quantity: whole(-mostQuantity, mostQuantity), unitPrice: signedMoney, projectId: optionalId, categoryId: optionalId, tax1: flag, tax2: flag,
  },
  200,
)

export const invoiceReaders = { ...termReaders, clientId: anId, number: text(40), issuedOn: date, paymentTerms: oneOf(...termNames), dueOn: date, lines: linesReader }
export const estimateReaders = { ...termReaders, clientId: anId, number: text(40), issuedOn: date, expiresOn: optional(date), lines: linesReader }
export const recurringReaders = {
  ...termReaders, clientId: anId, paymentTerms: oneOf(...termNames), paymentTermDays: optional(whole(0, 365)), frequency: oneOf('weekly', 'monthly', 'quarterly', 'yearly'),
  interval: whole(1, 60), startsOn: date, endsOn: optional(date), sendAutomatically: flag, lines: linesReader,
}
export const messageReaders = {
  kind: oneOf('sent', 'reminder', 'thank_you', 'note'), recipients: listOf({ name: text(120), email: newEmail }, 20), subject: text(300), body: text(8000),
}
export const answererName = personName

// Terms --------------------------------------------------------------------------------------------

const termDays = { upon_receipt: 0, net_15: 15, net_30: 30, net_45: 45, net_60: 60 } as const

export const dueDate = (issuedOn: IsoDate, terms: PaymentTerms, customDays: number | null): IsoDate =>
  addDays(issuedOn, terms === 'custom' ? (customDays ?? 0) : termDays[terms])

/** A tax has a name and a percentage, or neither. */
export function checkTerms(terms: DocumentTerms): DocumentTerms {
  const { subject, purchaseOrder, notes, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent } = terms
  if ((tax1Name === null) !== (tax1Percent === null)) throw invalidInput({ tax1Percent: 'Enter both the name of the tax and its percentage.' })
  if ((tax2Name === null) !== (tax2Percent === null)) throw invalidInput({ tax2Percent: 'Enter both the name of the tax and its percentage.' })
  return { subject, purchaseOrder, notes, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent }
}

// Lines --------------------------------------------------------------------------------------------

/** Projects on lines belong to the client, and the actor may bill them. `known` ones were there before. */
export async function checkLines(tx: Tx, actor: Actor, permission: 'invoices.manage' | 'estimates.manage', clientId: number, lines: readonly LineInput[], known: readonly (number | null)[] = []): Promise<void> {
  const wanted = [...new Set(lines.flatMap(({ projectId }) => (projectId === null ? [] : [projectId])))].sort((a, b) => a - b)
  for (const projectId of wanted) {
    const isNew = !known.includes(projectId)
    const [found] = isNew
      ? [await holdProject(tx, projectId, 'use').catch(() => undefined)]
      : await tx.select().from(projects).where(eq(projects.id, projectId)).for('share')
    if (!found || found.clientId !== clientId || (isNew && !can(actor, permission, { type: 'project', projectId }))) {
      throw invalidInput({ lines: 'Choose projects of this client.' })
    }
  }
  const categories = [...new Set(lines.flatMap(({ categoryId }) => (categoryId === null ? [] : [categoryId])))]
  if (categories.length > 0 && (await tx.select({ id: itemCategories.id }).from(itemCategories).where(inArray(itemCategories.id, categories))).length < categories.length) {
    throw invalidInput({ lines: 'Choose categories from the list.' })
  }
}

/** What is stored of lines that were typed. */
export const lineValues = (lines: readonly LineInput[]) =>
  lines.map(({ id: _id, ...line }, index) => ({ ...line, position: index + 1, amount: lineAmount(line) }))

// What new documents are made of ---------------------------------------------------------------------

export async function readDocumentOptions(ctx: AppContext, actor: Actor): Promise<DocumentOptions> {
  if (!holds(actor, 'invoices.manage') && !holds(actor, 'estimates.manage')) throw forbidden()
  const permission = holds(actor, 'invoices.manage') ? 'invoices.manage' : 'estimates.manage'
  const { db } = ctx
  const settings = await getSettings(db)
  const rows = await db.select().from(clients).where(and(isNull(clients.archivedAt), filterFor(db, actor, 'clients.view', 'client'))).orderBy(asc(clients.name))
  const open = await db.select().from(projects).where(isNull(projects.archivedAt)).orderBy(asc(projects.name))
  const categories = await db.select().from(itemCategories).where(isNull(itemCategories.archivedAt)).orderBy(asc(itemCategories.name))
  return {
    today: await todayOf(db, ownId(actor), ctx.now()),
    clients: rows.map((client): DocumentClient => ({
      id: client.id, name: client.name, currency: client.currency, tax1Name: client.tax1Name, tax1Percent: client.tax1Percent, tax2Name: client.tax2Name,
      tax2Percent: client.tax2Percent, discountPercent: client.discountPercent, paymentTerms: client.paymentTerms, paymentTermDays: client.paymentTermDays,
      projects: open
        .filter((project) => project.clientId === client.id && can(actor, permission, { type: 'project', projectId: project.id }))
        .map(({ id, name, code }) => ({ id, name, code })),
    })),
    categories: categories.map(({ id, name }) => ({ id, name })),
    invoiceNotes: settings.invoiceNotes, estimateNotes: settings.estimateNotes, estimateValidDays: settings.estimateValidDays,
  }
}

export async function companyHead(db: Db) {
  const { name, address, logoFileId } = await getSettings(db)
  return { name, address, logo: logoFileId !== null }
}

export async function contactsOf(db: Db, clientId: number): Promise<Recipient[]> {
  const rows = await db.select().from(contacts).where(eq(contacts.clientId, clientId)).orderBy(asc(contacts.name))
  return rows.flatMap(({ name, email }) => (email === null ? [] : [{ name, email }]))
}

// Links clients open without an account ----------------------------------------------------------------

export const makeLink = () => {
  const token = newToken()
  return { token, tokenHash: hashToken(token) }
}

/** The hash to look for, or the answer of every link that does not work. */
export function linkHash(token: unknown): string {
  if (!isToken(token)) throw linkInvalid()
  return hashToken(token)
}

/** The token is in the fragment, which browsers do not send. */
export const clientLink = (ctx: AppContext, kind: 'invoice' | 'estimate', token: string): string => `${ctx.publicUrl}client/${kind}#${token}`

export const toLinks = (rows: { id: number; createdAt: Date; lastViewedAt: Date | null; revokedAt: Date | null }[]): LinkRow[] =>
  rows.filter(({ revokedAt }) => revokedAt === null).map(({ id, createdAt, lastViewedAt }) => ({ id, createdAt: createdAt.toISOString(), lastViewedAt: lastViewedAt?.toISOString() ?? null }))

// Messages ----------------------------------------------------------------------------------------------

export const builtInMessages = {
  invoice: { label: 'Invoice', subject: 'Invoice {number} from {company}', body: 'Hello,\n\nHere is invoice {number} for {amount}, due on {due}:\n\n{link}\n\nThank you,\n{company}' },
  invoice_reminder: { label: 'Reminder of a late invoice', subject: 'Reminder: invoice {number} from {company}', body: 'Hello,\n\nInvoice {number} was due on {due}. {open} is still open:\n\n{link}\n\nIf you have paid in the meantime, please ignore this message.\n\nThank you,\n{company}' },
  invoice_thank_you: { label: 'Thank you for a payment', subject: 'Thank you for your payment of invoice {number}', body: 'Hello,\n\nWe have received your payment for invoice {number}. Thank you!\n\n{company}' },
  estimate: { label: 'Estimate', subject: 'Estimate {number} from {company}', body: 'Hello,\n\nHere is estimate {number} for {amount}. You can accept or decline it here:\n\n{link}\n\nThank you,\n{company}' },
} as const
export type MessageKey = keyof typeof builtInMessages

/** The company's wording, or the built-in one. */
export async function messageWording(db: Db, key: MessageKey): Promise<{ subject: string; body: string }> {
  const [own] = await db.select().from(messageTemplates).where(eq(messageTemplates.key, key))
  return own ?? builtInMessages[key]
}

/** Puts values for {names}. {link} stays for whoever sends it. */
export const fillIn = (wording: string, values: Record<string, string>): string => wording.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all)

/** Sends a message to each, with a link of its own. After the change was saved. */
export async function sendToClients(ctx: AppContext, message: MessageInput, about: { type: 'invoice' | 'estimate'; id: number }, link: string | undefined, createdBy: number | undefined): Promise<void> {
  for (const to of message.recipients) {
    await sendEmail(ctx.email, { kind: `${about.type}_${message.kind}`, to: { name: to.name || to.email, email: to.email }, subject: message.subject, body: message.body, link, about, createdBy })
  }
}

interface StoredMessage {
  id: number
  kind: string
  createdAt: Date
  senderId: number | null
  recipients: Recipient[]
  subject: string
  body: string
}

export async function toMessages(db: Db, rows: StoredMessage[]): Promise<MessageRow[]> {
  const senders = new Map((await db.select({ id: people.id, name: people.name }).from(people)).map(({ id, name }) => [id, name]))
  return rows.map(({ id, kind, createdAt, senderId, recipients, subject, body }) => ({
    id, kind, at: createdAt.toISOString(), sender: senderId === null ? null : (senders.get(senderId) ?? null), recipients, subject, body,
  }))
}

/** A message that is meant for someone has someone to go to. */
export function checkMessage({ kind, recipients, subject, body }: MessageInput): void {
  if (kind === 'note') {
    if (body === '') throw invalidInput({ body: 'Enter a note.' })
    return
  }
  if (recipients.length === 0) throw invalidInput({ recipients: 'Enter at least one email address.' })
  if (subject === '') throw invalidInput({ subject: 'Enter a subject.' })
}

export async function readFile(db: Db, id: number) {
  const [file] = await db.select().from(files).where(eq(files.id, id))
  return file
}
