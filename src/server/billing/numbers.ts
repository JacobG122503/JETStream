import { and, eq } from 'drizzle-orm'
import type { DocumentKind } from '../../shared/domain'
import type { Tx } from '../db'
import { estimates, invoices, numberSequences, retiredNumbers } from '../db/schema'

/**
 * Takes the next number in the caller's transaction. The sequence row stays locked until that
 * transaction ends, so numbers have no gaps when one is rolled back.
 */
export async function allocateNumber(tx: Tx, kind: DocumentKind): Promise<string> {
  const [sequence] = await tx.select().from(numberSequences).where(eq(numberSequences.kind, kind)).for('update')
  if (!sequence) throw new Error(`The ${kind} number sequence is missing.`)
  let next = sequence.nextNumber
  let number: string
  do {
    number = sequence.prefix + String(next).padStart(sequence.minimumDigits, '0')
    next++
  } while (await isTaken(tx, kind, number))
  await tx.update(numberSequences).set({ nextNumber: next }).where(eq(numberSequences.kind, kind))
  return number
}

/** Remembers the number of a document that is being deleted. */
export async function retireNumber(tx: Tx, kind: DocumentKind, number: string): Promise<void> {
  await tx.insert(retiredNumbers).values({ kind, number }).onConflictDoNothing()
}

/** Whether a document has the number, or had it and was deleted. */
async function isTaken(tx: Tx, kind: DocumentKind, number: string): Promise<boolean> {
  const documents = kind === 'invoice' ? invoices : estimates
  // One statement, so that a document deleted at this moment is seen in one place or the other.
  const rows = await tx
    .select({ number: documents.number })
    .from(documents)
    .where(eq(documents.number, number))
    .unionAll(
      tx
        .select({ number: retiredNumbers.number })
        .from(retiredNumbers)
        .where(and(eq(retiredNumbers.kind, kind), eq(retiredNumbers.number, number))),
    )
    .limit(1)
  return rows.length > 0
}
