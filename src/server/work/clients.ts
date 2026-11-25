/** Client companies. */
import { and, asc, count, eq, isNull, type SQL, sql } from 'drizzle-orm'
import type { ClientDetails, ClientRow } from '../../shared/work'
import type { Actor } from '../access/actor'
import { holds, requirePermission, requireRecord } from '../access/decisions'
import { filterFor } from '../access/filters'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { type Db, runTransaction, sumExact } from '../db'
import { clients, contacts, projects, timeEntries } from '../db/schema'
import { NotFoundError } from '../errors'
import { getSettings } from '../people/lookup'
import { listInvoices } from './invoices'
import { listProjects } from './projects'

async function readRows(db: Db, condition: SQL | undefined): Promise<ClientRow[]> {
  const rows = await db.select().from(clients).where(condition).orderBy(asc(sql`lower(${clients.name})`))
  const projectCounts = await db.select({ id: projects.clientId, count: count() }).from(projects).where(isNull(projects.archivedAt)).groupBy(projects.clientId)
  const contactCounts = await db.select({ id: contacts.clientId, count: count() }).from(contacts).groupBy(contacts.clientId)
  const minutes = await db
    .select({ id: projects.clientId, minutes: sumExact(timeEntries.minutes) })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .groupBy(projects.clientId)
  return rows.map(({ id, name, currency, archivedAt }) => ({
    id, name, currency, archived: archivedAt !== null,
    activeProjects: projectCounts.find((row) => row.id === id)?.count ?? 0,
    contacts: contactCounts.find((row) => row.id === id)?.count ?? 0,
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
  return {
    ...row,
    address: client.address,
    notes: client.notes,
    contactList: people.map((contact) => ({
      id: contact.id, name: contact.name, title: contact.title, email: contact.email, officePhone: contact.officePhone, mobilePhone: contact.mobilePhone,
    })),
    projects: await listProjects(ctx, actor, eq(projects.clientId, id)),
    ...(holds(actor, 'invoices.manage') && { invoices: (await listInvoices(ctx, actor, id)).invoices }),
  }
}

export interface NewClient {
  name: string
  currency: string
  address: string
}

export async function createClient(ctx: AppContext, actor: Actor, { name, currency, address }: NewClient): Promise<number> {
  requirePermission(actor, 'clients.manage', 'all')
  return runTransaction(ctx.db, async (tx) => {
    const same = await tx.select({ id: clients.id }).from(clients).where(and(eq(sql`lower(${clients.name})`, name.toLowerCase())))
    if (same.length > 0) throw invalidInput({ name: 'There is already a client with this name.' })
    const [client] = await tx.insert(clients).values({ name, address, currency: currency || (await getSettings(tx)).currency }).returning({ id: clients.id })
    if (!client) throw new Error('The client was not stored.')
    return client.id
  })
}
