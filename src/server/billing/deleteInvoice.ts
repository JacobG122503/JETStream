import { eq } from 'drizzle-orm'
import { type Db, runTransaction, StaleError } from '../db'
import { invoiceLines, invoices, payments } from '../db/schema'
import { BillingError } from './errors'
import { lockInvoice } from './invoiceTotals'
import { retireNumber } from './numbers'

/**
 * Deletes an invoice without payments. Its entries and expenses can be billed again; its number
 * is not used again.
 */
export function deleteInvoice(db: Db, invoiceId: number, expectedVersion: number): Promise<void> {
  return runTransaction(db, async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId)
    const paid = await tx.select({ id: payments.id }).from(payments).where(eq(payments.invoiceId, invoiceId)).limit(1)
    if (paid.length > 0) {
      throw new BillingError('invoice_has_payments', `Invoice ${invoice.number} has payments.`)
    }
    if (invoice.version !== expectedVersion) throw new StaleError(invoiceId, expectedVersion)
    await retireNumber(tx, 'invoice', invoice.number)
    // Lines take their links to entries and expenses with them.
    await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId))
    await tx.delete(invoices).where(eq(invoices.id, invoiceId))
  })
}
