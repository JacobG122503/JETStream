import { sql } from 'drizzle-orm'
import { integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { documentKinds } from '../../../shared/domain'
import { createdAt, oneOf, rule, updatedAt, version } from './columns'

/** Facts about this installation, one row each. */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/** The next invoice and estimate number. The row is locked while a number is taken. */
export const numberSequences = pgTable(
  'number_sequences',
  {
    kind: text('kind', { enum: documentKinds }).primaryKey(),
    prefix: text('prefix').notNull().default(''),
    nextNumber: integer('next_number').notNull().default(1),
    minimumDigits: integer('minimum_digits').notNull().default(1),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    oneOf(t.kind, documentKinds),
    rule(t.nextNumber, 'next_number_positive', sql`${t.nextNumber} > 0`),
    rule(t.minimumDigits, 'minimum_digits_range', sql`${t.minimumDigits} between 1 and 12`),
  ],
)

/** Numbers of deleted documents, which are never handed out again. */
export const retiredNumbers = pgTable(
  'retired_numbers',
  {
    kind: text('kind', { enum: documentKinds }).notNull(),
    number: text('number').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.number] }), oneOf(t.kind, documentKinds)],
)
