import { sql } from 'drizzle-orm'
import { boolean, foreignKey, integer, pgTable, text } from 'drizzle-orm/pg-core'
import { paymentTerms, recurringFrequencies, recurringStatuses } from '../../../shared/domain'
import { createdAt, dateOrder, day, id, indexes, oneOf, rule, updatedAt, version } from './columns'
import { documentColumns, documentRules, lineColumns } from './documents'
import { people } from './people'

/** A template an invoice is made from each time it is due. Amounts are calculated on the invoice. */
export const recurringInvoices = pgTable(
  'recurring_invoices',
  {
    id: id(),
    ...documentColumns(),
    paymentTerms: text('payment_terms', { enum: paymentTerms }).notNull().default('net_30'),
    paymentTermDays: integer('payment_term_days'),
    frequency: text('frequency', { enum: recurringFrequencies }).notNull(),
    /** Every how many weeks, months and so on. */
    interval: integer('interval').notNull().default(1),
    startsOn: day('starts_on').notNull(),
    nextOn: day('next_on'),
    endsOn: day('ends_on'),
    /** Sends the invoice instead of leaving a draft. */
    sendAutomatically: boolean('send_automatically').notNull().default(false),
    status: text('status', { enum: recurringStatuses }).notNull().default('active'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => people.id),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...documentRules(t),
    oneOf(t.paymentTerms, paymentTerms),
    rule(t.paymentTerms, 'custom_terms', sql`(${t.paymentTerms} = 'custom') = (${t.paymentTermDays} is not null)`),
    oneOf(t.frequency, recurringFrequencies),
    rule(t.interval, 'interval_range', sql`${t.interval} between 1 and 60`),
    dateOrder(t.startsOn, t.endsOn),
    oneOf(t.status, recurringStatuses),
    ...indexes(t.clientId, t.createdBy, t.nextOn),
  ],
)

export const recurringInvoiceLines = pgTable(
  'recurring_invoice_lines',
  {
    ...lineColumns(),
    recurringInvoiceId: integer('recurring_invoice_id').notNull(),
  },
  (t) => [
    // Named, because the generated name is longer than PostgreSQL allows.
    foreignKey({
      name: 'recurring_invoice_lines_recurring_invoice_fk',
      columns: [t.recurringInvoiceId],
      foreignColumns: [recurringInvoices.id],
    }).onDelete('cascade'),
    ...indexes(t.recurringInvoiceId, t.categoryId, t.projectId),
  ],
)
