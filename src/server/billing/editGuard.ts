import { eq } from 'drizzle-orm'
import { NotFoundError, StaleError, type Tx } from '../db'
import { expenses, invoiceExpenses, invoiceTimeEntries, timeEntries } from '../db/schema'

/** Why a time entry or expense may not be changed. Period locks and permissions come on top. */
export class EntryLockedError extends Error {
  override name = 'EntryLockedError'
  constructor(
    readonly entryId: number,
    readonly reason: 'invoiced' | 'approved',
  ) {
    super(`Entry ${entryId} cannot be changed: it is ${reason}.`)
  }
}

/**
 * Call it in the transaction that changes or deletes the entry, before doing so. It locks the
 * entry until that transaction ends, so that it cannot be billed meanwhile, and throws an
 * EntryLockedError, StaleError or NotFoundError if it may not be changed.
 */
export async function lockTimeEntryForEdit(tx: Tx, id: number, expectedVersion: number) {
  const [entry] = await tx.select().from(timeEntries).where(eq(timeEntries.id, id)).for('update')
  // A statement of its own, so that it sees a bill made while waiting for the lock.
  const links = await tx
    .select({ id: invoiceTimeEntries.timeEntryId })
    .from(invoiceTimeEntries)
    .where(eq(invoiceTimeEntries.timeEntryId, id))
  return checkEditable(entry, id, expectedVersion, links.length > 0)
}

export async function lockExpenseForEdit(tx: Tx, id: number, expectedVersion: number) {
  const [expense] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update')
  const links = await tx
    .select({ id: invoiceExpenses.expenseId })
    .from(invoiceExpenses)
    .where(eq(invoiceExpenses.expenseId, id))
  return checkEditable(expense, id, expectedVersion, links.length > 0)
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
