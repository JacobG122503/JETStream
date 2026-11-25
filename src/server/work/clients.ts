/** Client companies. */
import { and, asc, count, eq, isNotNull, isNull, ne, or, type SQL, sql } from 'drizzle-orm'
import type { ClientDetails, ClientInput, ClientRow, Contact } from '../../shared/work'
import type { Actor } from '../access/actor'
import { holds, requirePermission, requireRecord } from '../access/decisions'
import { filterFor } from '../access/filters'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { type Db, runTransaction, sumExact, type Tx, updateVersioned } from '../db'
import {
  clients, contacts, estimates, expenses, inviteClients, invoices, projectMembers, projects, projectTasks, recurringInvoices, retainers, timeEntries,
} from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { getSettings } from '../people/lookup'
import { differences, holdClient, logChange } from './common'
import { listInvoices } from './invoices'
import { listProjects } from './projects'

async function readRows(db: Db, condition: SQL | undefined): Promise<ClientRow[]> {
  const rows = await db.select().from(clients).where(condition).orderBy(asc(sql`lower(${clients.name})`))
  const projectCounts = await db.select({ id: projects.clientId, count: count() }).from(projects).where(isNull(projects.archivedAt)).groupBy(projects.clientId)
  const contactCounts = await db.select({ id: contacts.clientId, count: count() }).from(contacts).groupBy(contacts.clientId)
  const people = await db.select({ id: contacts.clientId, name: contacts.name }).from(contacts)
  const minutes = await db
    .select({ id: projects.clientId, minutes: sumExact(timeEntries.minutes) })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .groupBy(projects.clientId)
  return rows.map(({ id, name, currency, archivedAt }) => ({
    id, name, currency, archived: archivedAt !== null,
    activeProjects: projectCounts.find((row) => row.id === id)?.count ?? 0,
    contacts: contactCounts.find((row) => row.id === id)?.count ?? 0,
    contactNames: people.filter((row) => row.id === id).map((row) => row.name),
    minutes: minutes.find((row) => row.id === id)?.minutes ?? 0,
  }))
}

export async function listClients(db: Db, actor: Actor): Promise<{ clients: ClientRow[]; canManage: boolean }> {
  requirePermission(actor, 'clients.view')
  return { clients: await readRows(db, filterFor(db, actor, 'clients.view', 'client')), canManage: holds(actor, 'clients.manage', 'all') }
}

export async function readClient(ctx: AppContext, actor: Actor, id: number): Promise<ClientDetails> {
  requireRecord(actor, { view: 'clients.view' }, { type: 'client', clientId: id }, id)
  const { db } = ctx
  const [row] = await readRows(db, eq(clients.id, id))
  const [client] = await db.select().from(clients).where(eq(clients.id, id))
  if (!row || !client) throw new NotFoundError(id)
  const people = await db.select().from(contacts).where(eq(contacts.clientId, id)).orderBy(asc(contacts.name))
  const { tax1Name, tax1Percent, tax2Name, tax2Percent, discountPercent, paymentTerms, paymentTermDays } = client
  const canManage = holds(actor, 'clients.manage', 'all')
  return {
    ...row,
    version: client.version,
    address: client.address,
    notes: client.notes,
    canManage,
    currencyLocked: canManage ? await currencyLock(db, id) : null,
    ...((canManage || holds(actor, 'invoices.manage')) && {
      billing: { tax1Name, tax1Percent, tax2Name, tax2Percent, discountPercent, paymentTerms, paymentTermDays },
    }),
    contactList: people.map((contact) => ({
      id: contact.id, version: contact.version, name: contact.name, title: contact.title, email: contact.email, officePhone: contact.officePhone,
      mobilePhone: contact.mobilePhone,
    })),
    projects: await listProjects(ctx, actor, eq(projects.clientId, id)),
    ...(holds(actor, 'invoices.manage') && { invoices: (await listInvoices(ctx, actor, id)).invoices }),
  }
}

/** What is stored in the client's currency, in words; null when nothing is. */
async function currencyLock(db: Db | Tx, id: number): Promise<string | null> {
  const ofClient = eq(projects.clientId, id)
  const [amounts] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(ofClient, or(isNotNull(projects.rate), isNotNull(projects.fixedFee), isNotNull(projects.budgetAmount))))
    .limit(1)
  const [spent] = await db.select({ id: expenses.id }).from(expenses).innerJoin(projects, eq(projects.id, expenses.projectId)).where(ofClient).limit(1)
  const [taskAmounts] = await db
    .select({ id: projectTasks.id })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(and(ofClient, or(isNotNull(projectTasks.rate), isNotNull(projectTasks.budgetAmount))))
    .limit(1)
  const [memberRates] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(ofClient, isNotNull(projectMembers.rate)))
    .limit(1)
  const found = [
    (await db.$count(invoices, eq(invoices.clientId, id))) > 0 && 'invoices',
    (await db.$count(estimates, eq(estimates.clientId, id))) > 0 && 'estimates',
    (await db.$count(recurringInvoices, eq(recurringInvoices.clientId, id))) > 0 && 'recurring invoices',
    (await db.$count(retainers, eq(retainers.clientId, id))) > 0 && 'retainers',
    spent && 'expenses',
    (amounts ?? taskAmounts ?? memberRates) && 'amounts on projects',
  ].filter(Boolean)
  return found.length > 0 ? `The currency cannot be changed, because there are ${found.join(', ')} in it.` : null
}

const nameTaken = async (tx: Tx, name: string, exceptId = 0) => {
  const same = await tx.select({ id: clients.id }).from(clients).where(and(eq(sql`lower(${clients.name})`, name.toLowerCase()), ne(clients.id, exceptId)))
  if (same.length > 0) throw invalidInput({ name: 'There is already a client with this name.' })
}

const checkTerms = ({ paymentTerms, paymentTermDays }: Pick<ClientInput, 'paymentTerms' | 'paymentTermDays'>) => {
  if ((paymentTerms === 'custom') !== (paymentTermDays !== null)) throw invalidInput({ paymentTermDays: 'Enter the days for custom terms.' })
}

/** A new client, with the company's billing defaults. */
export async function createClient(ctx: AppContext, actor: Actor, { name, currency, address }: Pick<ClientInput, 'name' | 'currency' | 'address'>): Promise<number> {
  requirePermission(actor, 'clients.manage', 'all')
  return runTransaction(ctx.db, async (tx) => {
    await nameTaken(tx, name)
    const { tax1Name, tax1Percent, tax2Name, tax2Percent, paymentTerms, paymentTermDays } = await getSettings(tx)
    const [client] = await tx
      .insert(clients)
      .values({ name, address, currency, tax1Name, tax1Percent, tax2Name, tax2Percent, paymentTerms, paymentTermDays })
      .returning({ id: clients.id })
    if (!client) throw new Error('The client was not stored.')
    await logChange(tx, actor, { action: 'created', type: 'client', id: client.id, summary: `Created client ${name}` })
    return client.id
  })
}

export async function updateClient(ctx: AppContext, actor: Actor, id: number, { version, ...input }: ClientInput & { version: number }): Promise<void> {
  requirePermission(actor, 'clients.manage', 'all')
  checkTerms(input)
  await runTransaction(ctx.db, async (tx) => {
    const before = await holdClient(tx, id, 'change')
    await nameTaken(tx, input.name, id)
    if (input.currency !== before.currency) {
      const locked = await currencyLock(tx, id)
      if (locked) throw new ApiError(409, 'currency_locked', locked)
    }
    await updateVersioned(tx, clients, id, version, input)
    const changes = differences(before, { ...input })
    if (Object.keys(changes).length > 0) await logChange(tx, actor, { action: 'updated', type: 'client', id, summary: `Changed client ${input.name}`, changes })
  })
}

export async function archiveClient(ctx: AppContext, actor: Actor, id: number, archive: boolean): Promise<void> {
  requirePermission(actor, 'clients.manage', 'all')
  await runTransaction(ctx.db, async (tx) => {
    const client = await holdClient(tx, id, 'change')
    if ((client.archivedAt !== null) === archive) return
    if (archive) {
      const active = await tx.$count(projects, and(eq(projects.clientId, id), isNull(projects.archivedAt)))
      const recurring = await tx.$count(recurringInvoices, and(eq(recurringInvoices.clientId, id), eq(recurringInvoices.status, 'active')))
      if (active + recurring > 0) {
        throw new ApiError(409, 'client_in_use', `This client has ${active} active projects and ${recurring} active recurring invoices. Archive or end them first.`)
      }
    }
    await tx.update(clients).set({ archivedAt: archive ? ctx.now() : null }).where(eq(clients.id, id))
    await logChange(tx, actor, { action: archive ? 'archived' : 'restored', type: 'client', id, summary: `${archive ? 'Archived' : 'Restored'} client ${client.name}` })
  })
}

export async function deleteClient(ctx: AppContext, actor: Actor, id: number): Promise<void> {
  requirePermission(actor, 'clients.manage', 'all')
  await runTransaction(ctx.db, async (tx) => {
    const client = await holdClient(tx, id, 'change')
    const used =
      (await tx.$count(projects, eq(projects.clientId, id))) + (await tx.$count(invoices, eq(invoices.clientId, id))) +
      (await tx.$count(estimates, eq(estimates.clientId, id))) + (await tx.$count(recurringInvoices, eq(recurringInvoices.clientId, id))) +
      (await tx.$count(retainers, eq(retainers.clientId, id)))
    if (used > 0) throw new ApiError(409, 'client_in_use', 'This client has projects or invoices. Archive it instead.')
    await tx.delete(inviteClients).where(eq(inviteClients.clientId, id))
    await tx.delete(clients).where(eq(clients.id, id))
    await logChange(tx, actor, { action: 'deleted', type: 'client', id, summary: `Deleted client ${client.name}` })
  })
}

export type ContactInput = Omit<Contact, 'id' | 'version'>

export async function saveContact(ctx: AppContext, actor: Actor, clientId: number, contactId: number | null, { version, ...input }: ContactInput & { version: number | null }): Promise<void> {
  requirePermission(actor, 'clients.manage', 'all')
  await runTransaction(ctx.db, async (tx) => {
    const client = await holdClient(tx, clientId, 'change')
    if (contactId === null) {
      await tx.insert(contacts).values({ ...input, clientId })
    } else {
      const [found] = await tx.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.clientId, clientId)))
      if (!found) throw new NotFoundError(contactId)
      await updateVersioned(tx, contacts, contactId, version ?? 0, input)
    }
    await logChange(tx, actor, { action: 'updated', type: 'client', id: clientId, summary: `Saved contact ${input.name} of ${client.name}` })
  })
}

export async function deleteContact(ctx: AppContext, actor: Actor, clientId: number, contactId: number): Promise<void> {
  requirePermission(actor, 'clients.manage', 'all')
  await runTransaction(ctx.db, async (tx) => {
    const client = await holdClient(tx, clientId, 'change')
    const [found] = await tx.delete(contacts).where(and(eq(contacts.id, contactId), eq(contacts.clientId, clientId))).returning()
    if (!found) throw new NotFoundError(contactId)
    await logChange(tx, actor, { action: 'updated', type: 'client', id: clientId, summary: `Deleted contact ${found.name} of ${client.name}` })
  })
}
