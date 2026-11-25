import { eq } from 'drizzle-orm'
import type { Actor } from '../access/actor'
import { can, forbidden, owns, type RecordFacts, requireRecord } from '../access/decisions'
import { NotFoundError, StaleError, type Tx } from '../db'
import { expenses, invoiceExpenses, invoiceTimeEntries, timeEntries } from '../db/schema'

/** Why a time entry or expense may not be changed, by anyone. Period locks come on top. */
export class EntryLockedError extends Error {
  override name = 'EntryLockedError'
  constructor(
    readonly entryId: number,
    readonly reason: 'invoiced' | 'approved',
  ) {
    super(`Entry ${entryId} cannot be changed: it is ${reason}.`)
  }
}

/** Where a change moves the entry to, as far as it does. */
export interface Move {
  personId?: number
  projectId?: number
}

/**
 * Call it in the transaction that changes or deletes the entry, before doing so. It locks the
 * entry until that transaction ends, so that it cannot be billed meanwhile. Throws, in this order:
 * NotFoundError if the actor may not see the entry, forbidden if they may not change it where it is
 * and where it goes, then EntryLockedError and StaleError. Nobody's permission goes past the lock.
 */
export async function lockTimeEntryForEdit(tx: Tx, actor: Actor, id: number, expectedVersion: number, move: Move = {}) {
  const [entry] = await tx.select().from(timeEntries).where(eq(timeEntries.id, id)).for('update')
  // A statement of its own, so that it sees a bill made while waiting for the lock.
  const links = await tx
    .select({ id: invoiceTimeEntries.timeEntryId })
    .from(invoiceTimeEntries)
    .where(eq(invoiceTimeEntries.timeEntryId, id))
  checkAllowed(actor, 'timeEntry', entry, id, move)
  return checkEditable(entry, id, expectedVersion, links.length > 0)
}

export async function lockExpenseForEdit(tx: Tx, actor: Actor, id: number, expectedVersion: number, move: Move = {}) {
  const [expense] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update')
  const links = await tx
    .select({ id: invoiceExpenses.expenseId })
    .from(invoiceExpenses)
    .where(eq(invoiceExpenses.expenseId, id))
  checkAllowed(actor, 'expense', expense, id, move)
  return checkEditable(expense, id, expectedVersion, links.length > 0)
}

/** Being a member of the project it goes to is another question, for whoever makes the change. */
function checkAllowed(
  actor: Actor, type: 'timeEntry' | 'expense', entry: { personId: number; projectId: number } | undefined, id: number, move: Move,
): void {
  const facts: RecordFacts | undefined = entry && { type, personId: entry.personId, projectId: entry.projectId }
  requireRecord(actor, { view: 'time.view', action: 'time.edit', orOwner: true }, facts, id)
  if (!facts) return
  const moved: RecordFacts = { ...facts, ...(move.personId !== undefined && { personId: move.personId }), ...(move.projectId !== undefined && { projectId: move.projectId }) }
  if (!owns(actor, moved) && !can(actor, 'time.edit', moved)) throw forbidden()
}

function checkEditable<T extends { status: string; version: number }>(
  entry: T | undefined,
  id: number,
  expectedVersion: number,
  invoiced: boolean,
): T {
  if (!entry) throw new NotFoundError(id)
  if (invoiced) throw new EntryLockedError(id, 'invoiced')
  if (entry.status === 'approved') throw new EntryLockedError(id, 'approved')
  if (entry.version !== expectedVersion) throw new StaleError(id, expectedVersion)
  return entry
}
