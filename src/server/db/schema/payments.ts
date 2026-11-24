import { sql } from 'drizzle-orm'
import { index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core'
import { paymentMethods, reminderStatuses, retainerEntryKinds, retainerStatuses } from '../../../shared/domain'
import { clients } from './clients'
import {
  createdAt, currencyCode, day, id, indexes, instant, money, oneOf, rule, updatedAt, version,
} from './columns'
import { invoices } from './invoices'
import { people } from './people'
import { projects } from './projects'

/** Payments are added through src/server/billing, which keeps the invoice's totals and status. */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    // No cascade: an invoice with payments cannot be deleted.
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id),
    amount: money('amount').notNull(),
    paidOn: day('paid_on').notNull(),
    method: text('method', { enum: paymentMethods }).notNull(),
    /** Such as a check number. */
    reference: text('reference').notNull().default(''),
    notes: text('notes').notNull().default(''),
    /** The online payment service, with its own reference; `simulated` takes no real money. */
    provider: text('provider'),
    providerReference: text('provider_reference'),
    recordedBy: integer('recorded_by').references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [
    rule(t.amount, 'amount_positive', sql`${t.amount} > 0`),
    oneOf(t.method, paymentMethods),
    rule(t.method, 'online_has_provider', sql`(${t.method} = 'online') = (${t.provider} is not null)`),
    rule(t.provider, 'provider_and_reference', sql`(${t.provider} is null) = (${t.providerReference} is null)`),
    unique('payments_provider_reference_key').on(t.provider, t.providerReference),
    index('payments_date_idx').on(t.paidOn),
    ...indexes(t.invoiceId, t.recordedBy),
  ],
)

export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    paymentId: integer('payment_id')
      .notNull()
      .references(() => payments.id),
    amount: money('amount').notNull(),
    refundedOn: day('refunded_on').notNull(),
    reason: text('reason').notNull().default(''),
    /** The payment service's reference of the refund. */
    providerReference: text('provider_reference').unique(),
    recordedBy: integer('recorded_by').references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [rule(t.amount, 'amount_positive', sql`${t.amount} > 0`), ...indexes(t.paymentId, t.recordedBy)],
)

/** Given up on: the invoice is closed and the amount will not be paid. */
export const invoiceWriteOffs = pgTable(
  'invoice_write_offs',
  {
    invoiceId: integer('invoice_id')
      .primaryKey()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amount: money('amount').notNull(),
    writtenOffOn: day('written_off_on').notNull(),
    reason: text('reason').notNull().default(''),
    recordedBy: integer('recorded_by').references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [rule(t.amount, 'amount_positive', sql`${t.amount} > 0`), ...indexes(t.recordedBy)],
)

/** Late reminders, one per invoice and day. */
export const invoiceReminders = pgTable(
  'invoice_reminders',
  {
    id: id(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    remindOn: day('remind_on').notNull(),
    status: text('status', { enum: reminderStatuses }).notNull().default('scheduled'),
    sentAt: instant('sent_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('invoice_reminders_invoice_day_key').on(t.invoiceId, t.remindOn),
    oneOf(t.status, reminderStatuses),
    index('invoice_reminders_status_day_idx').on(t.status, t.remindOn),
  ],
)

/** Money paid in advance. The balance is the sum of the ledger. */
export const retainers = pgTable(
  'retainers',
  {
    id: id(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    projectId: integer('project_id').references(() => projects.id),
    name: text('name').notNull(),
    currency: text('currency').notNull(),
    status: text('status', { enum: retainerStatuses }).notNull().default('active'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...currencyCode(t.currency),
    oneOf(t.status, retainerStatuses),
    ...indexes(t.clientId, t.projectId),
  ],
)

export const retainerEntries = pgTable(
  'retainer_entries',
  {
    id: id(),
    retainerId: integer('retainer_id')
      .notNull()
      .references(() => retainers.id),
    kind: text('kind', { enum: retainerEntryKinds }).notNull(),
    /** Positive adds to the balance, negative takes from it. */
    amount: money('amount').notNull(),
    occurredOn: day('occurred_on').notNull(),
    /** The invoice that asked for the money, or that was paid from the retainer. */
    invoiceId: integer('invoice_id').references(() => invoices.id),
    paymentId: integer('payment_id')
      .unique()
      .references(() => payments.id),
    notes: text('notes').notNull().default(''),
    recordedBy: integer('recorded_by').references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf(t.kind, retainerEntryKinds),
    rule(
      t.amount,
      'amount_sign',
      sql`case ${t.kind} when 'top_up' then ${t.amount} > 0 when 'adjustment' then ${t.amount} <> 0 else ${t.amount} < 0 end`,
    ),
    ...indexes(t.retainerId, t.invoiceId, t.recordedBy),
  ],
)
