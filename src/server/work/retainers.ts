/** Money that clients pay in advance. The balance is the sum of what came and went. */
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import type { RetainerDetails, RetainerRow, Statement } from '../../shared/billing'
import { ageing } from '../../shared/calc'
import { addMonths, type IsoDate } from '../../shared/dates'
import { type Actor, actorId } from '../access/actor'
import { can, requirePermission } from '../access/decisions'
import { filterFor } from '../access/filters'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { type Db, runTransaction, sumExact, type Tx } from '../db'
import { clients, invoices, payments, projects, retainerEntries, retainers } from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { holdClient, logChange } from './common'
import { companyHead } from './documents'
import { listInvoices, retainersWithMoney } from './invoices'

type Retainer = typeof retainers.$inferSelect

/** By its project, or by the client. */
const may = (actor: Actor, { projectId, clientId }: Pick<Retainer, 'projectId' | 'clientId'>): boolean =>
  projectId === null ? can(actor, 'payments.manage', { type: 'client', clientId }) : can(actor, 'payments.manage', { type: 'project', projectId })

const balanceOf = async (db: Db | Tx, id: number) => {
  const [sum] = await db.select({ balance: sumExact(retainerEntries.amount) }).from(retainerEntries).where(eq(retainerEntries.retainerId, id))
  return sum?.balance ?? 0
}

async function rowsOf(db: Db, actor: Actor, id?: number): Promise<RetainerRow[]> {
  const rows = await db
    .select({ retainer: retainers, client: clients.name, project: projects.name })
    .from(retainers)
    .innerJoin(clients, eq(clients.id, retainers.clientId))
    .leftJoin(projects, eq(projects.id, retainers.projectId))
    .where(id === undefined ? undefined : eq(retainers.id, id))
    .orderBy(asc(clients.name), asc(retainers.name))
  const found: RetainerRow[] = []
  for (const { retainer, client, project } of rows) {
    if (!may(actor, retainer)) continue
    found.push({
      id: retainer.id, version: retainer.version, name: retainer.name, client: { id: retainer.clientId, name: client }, currency: retainer.currency, status: retainer.status,
      project: retainer.projectId === null ? null : { id: retainer.projectId, name: project ?? '' }, balance: await balanceOf(db, retainer.id),
    })
  }
  return found
}

export async function listRetainers(db: Db, actor: Actor): Promise<{ retainers: RetainerRow[] }> {
  requirePermission(actor, 'payments.manage')
  return { retainers: await rowsOf(db, actor) }
}

export async function readRetainer(db: Db, actor: Actor, id: number): Promise<RetainerDetails> {
  requirePermission(actor, 'payments.manage')
  const [row] = await rowsOf(db, actor, id)
  if (!row) throw new NotFoundError(id)
  const entries = await db
    .select({ entry: retainerEntries, number: invoices.number })
    .from(retainerEntries)
    .leftJoin(invoices, eq(invoices.id, retainerEntries.invoiceId))
    .where(eq(retainerEntries.retainerId, id))
    .orderBy(desc(retainerEntries.occurredOn), desc(retainerEntries.id))
  const open = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.clientId, row.client.id), eq(invoices.status, 'open'), eq(invoices.currency, row.currency), filterFor(db, actor, 'invoices.manage', 'invoice')))
    .orderBy(asc(invoices.dueOn))
  return {
    ...row,
    entries: entries.map(({ entry, number }) => ({
      id: entry.id, kind: entry.kind, amount: entry.amount, on: entry.occurredOn, notes: entry.notes,
      invoice: entry.invoiceId === null || number === null ? null : { id: entry.invoiceId, number },
    })),
    openInvoices: open.map(({ id: invoiceId, number, dueAmount }) => ({ id: invoiceId, number, dueAmount })),
  }
}

export async function createRetainer(ctx: AppContext, actor: Actor, input: { clientId: number; projectId: number | null; name: string }): Promise<number> {
  requirePermission(actor, 'payments.manage')
  return runTransaction(ctx.db, async (tx) => {
    const client = await holdClient(tx, input.clientId, 'use')
    if (input.projectId !== null) {
      const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId)).for('share')
      if (project?.clientId !== client.id) throw invalidInput({ projectId: 'Choose a project of the client.' })
    }
    if (!may(actor, input)) throw invalidInput({ clientId: 'Choose a client from the list.' })
    const [row] = await tx.insert(retainers).values({ ...input, currency: client.currency }).returning()
    if (!row) throw new Error('The retainer was not stored.')
    await logChange(tx, actor, { action: 'created', type: 'retainer', id: row.id, summary: `Created retainer ${row.name}` })
    return row.id
  })
}

async function lock(tx: Tx, actor: Actor, id: number): Promise<Retainer> {
  const [row] = await tx.select().from(retainers).where(eq(retainers.id, id)).for('update')
  if (!row || !may(actor, row)) throw new NotFoundError(id)
  return row
}

export interface RetainerEntryInput {
  kind: 'top_up' | 'refund' | 'adjustment'
  /** Above 0; an adjustment may be below. */
  amount: number
  on: IsoDate
  notes: string
  /** The invoice that asked for the money. */
  invoiceId: number | null
}

/** Money that came in or was given back, recorded by hand. Nothing is charged. */
export async function addRetainerEntry(ctx: AppContext, actor: Actor, id: number, { kind, amount, on, notes, invoiceId }: RetainerEntryInput): Promise<void> {
  requirePermission(actor, 'payments.manage')
  if (kind !== 'adjustment' && amount <= 0) throw invalidInput({ amount: 'Enter an amount above 0.' })
  if (amount === 0) throw invalidInput({ amount: 'Enter an amount.' })
  await runTransaction(ctx.db, async (tx) => {
    const row = await lock(tx, actor, id)
    if (row.status !== 'active') throw new ApiError(409, 'retainer_closed', 'This retainer is closed.')
    const signed = kind === 'refund' ? -amount : amount
    if ((await balanceOf(tx, id)) + signed < 0) throw invalidInput({ amount: 'There is not that much left.' })
    if (invoiceId !== null) {
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.clientId, row.clientId)))
      if (!invoice) throw invalidInput({ invoiceId: 'Choose an invoice of the client.' })
    }
    await tx.insert(retainerEntries).values({ retainerId: id, kind, amount: signed, occurredOn: on, notes, invoiceId, recordedBy: actorId(actor) })
    await logChange(tx, actor, { action: 'updated', type: 'retainer', id, summary: `Recorded ${kind === 'top_up' ? 'a top-up' : kind === 'refund' ? 'a refund' : 'an adjustment'} of retainer ${row.name}`, changes: { amount: signed } })
  })
}

export async function setRetainerStatus(ctx: AppContext, actor: Actor, id: number, status: 'active' | 'closed'): Promise<void> {
  requirePermission(actor, 'payments.manage')
  await runTransaction(ctx.db, async (tx) => {
    const row = await lock(tx, actor, id)
    if (status === 'closed' && (await balanceOf(tx, id)) !== 0) throw new ApiError(409, 'has_balance', 'Money is left on it. Use it or give it back first.')
    await tx.update(retainers).set({ status }).where(eq(retainers.id, id))
    await logChange(tx, actor, { action: 'updated', type: 'retainer', id, summary: `${status === 'closed' ? 'Closed' : 'Reopened'} retainer ${row.name}` })
  })
}

/** What a client owes, and what they paid lately. */
export async function readStatement(ctx: AppContext, actor: Actor, clientId: number): Promise<Statement> {
  const { db } = ctx
  requirePermission(actor, 'invoices.manage')
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), filterFor(db, actor, 'clients.view', 'client')))
  if (!client) throw new NotFoundError(clientId)
  const { today, invoices: all } = await listInvoices(ctx, actor, clientId)
  const open = all.filter(({ status }) => status === 'open').sort((a, b) => a.dueOn.localeCompare(b.dueOn))
  const ids = all.map(({ id }) => id)
  const paid = ids.length === 0 ? [] : await db
    .select({ number: invoices.number, paidOn: payments.paidOn, amount: payments.amount, method: payments.method })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(and(inArray(payments.invoiceId, ids), gte(payments.paidOn, addMonths(today, -3))))
    .orderBy(desc(payments.paidOn), desc(payments.id))
  return {
    client: { id: client.id, name: client.name, address: client.address, currency: client.currency }, company: await companyHead(db), today, invoices: open,
    payments: paid.map(({ number, ...payment }) => ({ invoice: number, ...payment })), ageing: ageing(open, today),
    retainers: await retainersWithMoney(db, clientId, client.currency),
  }
}
