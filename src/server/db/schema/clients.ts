import { sql } from 'drizzle-orm'
import { integer, pgTable, text } from 'drizzle-orm/pg-core'
import { paymentTerms } from '../../../shared/domain'
import {
  createdAt, currencyCode, id, indexes, instant, oneOf, percent, percentRange, rule, uniqueIgnoringCase, updatedAt,
  version,
} from './columns'

/** Client companies. */
export const clients = pgTable(
  'clients',
  {
    id: id(),
    name: text('name').notNull(),
    address: text('address').notNull().default(''),
    currency: text('currency').notNull(),
    /** Defaults for the client's invoices and estimates. */
    tax1Name: text('tax1_name'),
    tax1Percent: percent('tax1_percent'),
    tax2Name: text('tax2_name'),
    tax2Percent: percent('tax2_percent'),
    discountPercent: percent('discount_percent'),
    paymentTerms: text('payment_terms', { enum: paymentTerms }).notNull().default('net_30'),
    /** Days until due; set exactly when the terms are custom. */
    paymentTermDays: integer('payment_term_days'),
    notes: text('notes').notNull().default(''),
    archivedAt: instant('archived_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIgnoringCase(t.name),
    ...currencyCode(t.currency),
    ...percentRange(t.tax1Percent, t.tax2Percent, t.discountPercent),
    oneOf(t.paymentTerms, paymentTerms),
    rule(t.paymentTerms, 'custom_terms', sql`(${t.paymentTerms} = 'custom') = (${t.paymentTermDays} is not null)`),
    rule(t.paymentTermDays, 'term_days_range', sql`${t.paymentTermDays} between 0 and 730`),
  ],
)

export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    title: text('title').notNull().default(''),
    email: text('email'),
    officePhone: text('office_phone'),
    mobilePhone: text('mobile_phone'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => indexes(t.clientId),
)
