import { asc, eq } from 'drizzle-orm'
import { amountDue, documentTotals } from '../../shared/calc'
import { NotFoundError, sumExact, type Tx } from '../db'
import { invoiceLines, invoices, payments, refunds } from '../db/schema'
import { BillingError } from './errors'

export type Invoice = typeof invoices.$inferSelect

/** Locks the invoice until the transaction ends. */
export async function lockInvoice(tx: Tx, invoiceId: number): Promise<Invoice> {
  const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update')
  if (!invoice) throw new NotFoundError(invoiceId)
  return invoice
}

/** Locks an invoice whose lines are about to change, refusing paid and closed ones. */
export async function lockInvoiceForLines(tx: Tx, invoiceId: number): Promise<Invoice> {
  const invoice = await lockInvoice(tx, invoiceId)
  if (invoice.status !== 'draft' && invoice.status !== 'open') {
    throw new BillingError('invoice_not_editable', `Invoice ${invoice.number} is ${invoice.status}.`)
  }
  return invoice
}

/**
 * Calculates the stored totals from the lines, payments and refunds, and sets an open invoice to
 * paid, or a paid one back to open, to match what is due. Call it in the transaction that changed
 * any of these, with the invoice locked.
 *
 * `settledOn` is the date to record when the invoice becomes paid.
 */
export async function recalculateInvoice(tx: Tx, invoice: Invoice, settledOn?: string): Promise<Invoice> {
  const lines = await tx
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoice.id))
    .orderBy(asc(invoiceLines.position), asc(invoiceLines.id))
  const { lineAmounts, subtotal, discount, tax1, tax2, total } = documentTotals(lines, invoice)
  for (const [index, line] of lines.entries()) {
    const amount = lineAmounts[index]
    if (amount !== undefined && amount !== line.amount) {
      await tx.update(invoiceLines).set({ amount }).where(eq(invoiceLines.id, line.id))
    }
  }

  const { received, refunded, lastPaidOn } = await paidSoFar(tx, invoice.id)
  const due = amountDue(total, received, [refunded])
  const paid = total - due
  let { status } = invoice
  if (status === 'open' && paid > 0 && due <= 0) status = 'paid'
  else if (status === 'paid' && due > 0) status = 'open'
  const [updated] = await tx
    .update(invoices)
    .set({
      subtotal,
      discountAmount: discount,
      tax1Amount: tax1,
      tax2Amount: tax2,
      total,
      paidAmount: paid,
      dueAmount: due,
      status,
      paidOn: status !== 'paid' ? null : (invoice.paidOn ?? settledOn ?? lastPaidOn),
    })
    .where(eq(invoices.id, invoice.id))
    .returning()
  if (!updated) throw new NotFoundError(invoice.id)
  return updated
}

async function paidSoFar(tx: Tx, invoiceId: number) {
  const received = await tx
    .select({ amount: payments.amount, paidOn: payments.paidOn })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId))
    .orderBy(asc(payments.paidOn))
  const [refunded] = await tx
    .select({ amount: sumExact(refunds.amount) })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .where(eq(payments.invoiceId, invoiceId))
  return {
    received: received.map(({ amount }) => amount),
    refunded: refunded?.amount ?? 0,
    lastPaidOn: received.at(-1)?.paidOn ?? null,
  }
}

/**
 * Changes an invoice's lines by any means and keeps its stored totals right, all in the caller's
 * transaction. The invoice must be a draft or open.
 */
export async function changeInvoiceLines(
  tx: Tx,
  invoiceId: number,
  change: (invoice: Invoice) => Promise<void>,
): Promise<Invoice> {
  const invoice = await lockInvoiceForLines(tx, invoiceId)
  await change(invoice)
  return recalculateInvoice(tx, invoice)
}
