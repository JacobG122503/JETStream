import { sql } from 'drizzle-orm'
import { type AnyPgColumn, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { invoiceStatuses, lineKinds, messageKinds, paymentTerms } from '../../../shared/domain'
import {
  createdAt, dateOrder, day, id, indexes, instant, minutes, money, notNegative, oneOf, rule, updatedAt, version,
} from './columns'
import { documentColumns, documentRules, lineColumns, totalColumns, totalRules } from './documents'
import { expenses } from './expenses'
import { files, people } from './people'
import { recurringInvoices } from './recurring'
import { timeEntries } from './time'

/** The stored totals and status change only in src/server/billing. */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    number: text('number').notNull().unique(),
    ...documentColumns(),
    status: text('status', { enum: invoiceStatuses }).notNull().default('draft'),
    issuedOn: day('issued_on').notNull(),
    dueOn: day('due_on').notNull(),
    paymentTerms: text('payment_terms', { enum: paymentTerms }).notNull().default('net_30'),
    ...totalColumns(),
    /** Payments less refunds. */
    paidAmount: money('paid_amount').notNull().default(0),
    /** Total less paidAmount. */
    dueAmount: money('due_amount').notNull().default(0),
    sentAt: instant('sent_at'),
    paidOn: day('paid_on'),
    closedOn: day('closed_on'),
    recurringInvoiceId: integer('recurring_invoice_id').references((): AnyPgColumn => recurringInvoices.id),
    /** The due date of the recurring invoice it was made for. */
    recurringOn: day('recurring_on'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => people.id),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...documentRules(t),
    totalRules(t),
    rule(t.dueAmount, 'due_adds_up', sql`${t.dueAmount} = ${t.total} - ${t.paidAmount}`),
    oneOf(t.status, invoiceStatuses),
    oneOf(t.paymentTerms, paymentTerms),
    dateOrder(t.issuedOn, t.dueOn),
    uniqueIndex('invoices_recurring_key').on(t.recurringInvoiceId, t.recurringOn),
    index('invoices_status_due_idx').on(t.status, t.dueOn),
    ...indexes(t.clientId, t.createdBy),
  ],
)

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    ...lineColumns(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: lineKinds }).notNull(),
    /** Set exactly on lines of time: the sum of the linked entries' billed minutes. */
    minutes: minutes('minutes'),
  },
  (t) => [
    oneOf(t.kind, lineKinds),
    rule(t.minutes, 'minutes_if_time', sql`(${t.kind} = 'time') = (${t.minutes} is not null)`),
    ...notNegative(t.minutes),
    index('invoice_lines_invoice_idx').on(t.invoiceId, t.position),
    ...indexes(t.categoryId, t.projectId),
  ],
)

/** A billed time entry. The key allows an entry on one line only. */
export const invoiceTimeEntries = pgTable(
  'invoice_time_entries',
  {
    timeEntryId: integer('time_entry_id')
      .primaryKey()
      // No cascade: deleting a billed entry fails.
      .references(() => timeEntries.id),
    lineId: integer('line_id')
      .notNull()
      .references(() => invoiceLines.id, { onDelete: 'cascade' }),
    /** As billed, after time rounding. */
    minutes: minutes('minutes').notNull(),
    rate: money('rate').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [...notNegative(t.minutes, t.rate), ...indexes(t.lineId)],
)

/** A billed expense. The key allows an expense on one line only. */
export const invoiceExpenses = pgTable(
  'invoice_expenses',
  {
    expenseId: integer('expense_id')
      .primaryKey()
      .references(() => expenses.id),
    lineId: integer('line_id')
      .notNull()
      .references(() => invoiceLines.id, { onDelete: 'cascade' }),
    amount: money('amount').notNull(),
  },
  (t) => indexes(t.lineId),
)

/** What was sent to the client about an invoice, and notes on it. */
export const invoiceMessages = pgTable(
  'invoice_messages',
  {
    id: id(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: messageKinds }).notNull(),
    senderId: integer('sender_id').references(() => people.id),
    recipients: jsonb('recipients').$type<{ name: string; email: string }[]>().notNull().default([]),
    subject: text('subject').notNull().default(''),
    body: text('body').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [oneOf(t.kind, messageKinds), ...indexes(t.invoiceId, t.senderId)],
)

/** Links a client opens without an account. A lost link is replaced, as only its hash is kept. */
export const invoiceLinks = pgTable(
  'invoice_links',
  {
    id: id(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: integer('created_by').references(() => people.id),
    revokedAt: instant('revoked_at'),
    lastViewedAt: instant('last_viewed_at'),
    createdAt: createdAt(),
  },
  (t) => indexes(t.invoiceId, t.createdBy),
)

export const invoiceAttachments = pgTable(
  'invoice_attachments',
  {
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    fileId: integer('file_id')
      .notNull()
      .references(() => files.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.invoiceId, t.fileId] }), ...indexes(t.fileId)],
)
