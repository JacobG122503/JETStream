import { eq } from 'drizzle-orm'
import { type Db, NotFoundError, runTransaction, sumExact, type Tx } from '../db'
import { payments, refunds } from '../db/schema'
import { BillingError } from './errors'
import { type Invoice, lockInvoice, recalculateInvoice } from './invoiceTotals'

export type Payment = typeof payments.$inferSelect
export type NewPayment = Omit<typeof payments.$inferInsert, 'id' | 'createdAt'>

/** Records a payment on an open invoice, and sets the invoice to paid when nothing is due. */
export function recordPayment(db: Db, payment: NewPayment): Promise<{ payment: Payment; invoice: Invoice }> {
  return runTransaction(db, (tx) => recordPaymentIn(tx, payment))
}

/** The same in the caller's transaction, such as one that draws on a retainer locked before. */
export async function recordPaymentIn(tx: Tx, payment: NewPayment) {
  assertPositive(payment.amount)
  const invoice = await lockInvoice(tx, payment.invoiceId)
  if (invoice.status === 'draft' || invoice.status === 'closed') {
    throw new BillingError('invoice_not_payable', `Invoice ${invoice.number} is ${invoice.status}.`)
  }
  if (payment.amount > invoice.dueAmount) {
    throw new BillingError('payment_exceeds_due', `Invoice ${invoice.number} has less than that due.`)
  }
  const [recorded] = await tx.insert(payments).values(payment).returning()
  if (!recorded) throw new Error('The payment was not stored.')
  return { payment: recorded, invoice: await recalculateInvoice(tx, invoice, payment.paidOn) }
}

export type Refund = typeof refunds.$inferSelect
export type NewRefund = Omit<typeof refunds.$inferInsert, 'id' | 'createdAt'>

/** Records money given back, and opens a paid invoice again. */
export function recordRefund(db: Db, refund: NewRefund): Promise<{ refund: Refund; invoice: Invoice }> {
  return runTransaction(db, async (tx) => {
    assertPositive(refund.amount)
    const [payment] = await tx.select().from(payments).where(eq(payments.id, refund.paymentId))
    if (!payment) throw new NotFoundError(refund.paymentId)
    // Payments never move to another invoice, so locking the invoice protects this payment too.
    const invoice = await lockInvoice(tx, payment.invoiceId)
    if (invoice.status === 'closed') throw new BillingError('invoice_closed', `Invoice ${invoice.number} is closed.`)
    const [refunded] = await tx
      .select({ amount: sumExact(refunds.amount) })
      .from(refunds)
      .where(eq(refunds.paymentId, payment.id))
    if (refund.amount > payment.amount - (refunded?.amount ?? 0)) {
      throw new BillingError('refund_exceeds_payment', 'More than was paid cannot be given back.')
    }
    const [recorded] = await tx.insert(refunds).values(refund).returning()
    if (!recorded) throw new Error('The refund was not stored.')
    return { refund: recorded, invoice: await recalculateInvoice(tx, invoice) }
  })
}

function assertPositive(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new BillingError('amount_not_positive', 'The amount must be a whole number of minor units above 0.')
  }
}

/** Takes back a payment that was recorded by mistake, with its refunds. Also opens a paid invoice again. */
export async function removePaymentIn(tx: Tx, paymentId: number): Promise<{ payment: Payment; invoice: Invoice }> {
  const [seen] = await tx.select().from(payments).where(eq(payments.id, paymentId))
  if (!seen) throw new NotFoundError(paymentId)
  const invoice = await lockInvoice(tx, seen.invoiceId)
  if (invoice.status === 'closed') throw new BillingError('invoice_closed', `Invoice ${invoice.number} is closed.`)
  await tx.delete(refunds).where(eq(refunds.paymentId, paymentId))
  const [payment] = await tx.delete(payments).where(eq(payments.id, paymentId)).returning()
  if (!payment) throw new NotFoundError(paymentId)
  return { payment, invoice: await recalculateInvoice(tx, invoice) }
}
