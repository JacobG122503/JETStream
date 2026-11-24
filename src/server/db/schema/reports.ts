import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core'
import { reportVisibilities, scheduleFrequencies } from '../../../shared/domain'
import { createdAt, currencyCode, day, exchangeRate, id, indexes, instant, oneOf, rule, updatedAt, version } from './columns'
import { people } from './people'

export const savedReports = pgTable(
  'saved_reports',
  {
    id: id(),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Which report, such as time or profitability (015, 016). */
    kind: text('kind').notNull(),
    /** Its filters, grouping and period. */
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull().default({}),
    visibility: text('visibility', { enum: reportVisibilities }).notNull().default('private'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [oneOf(t.visibility, reportVisibilities), ...indexes(t.ownerId)],
)

/** People a shared report is limited to; none means everyone who may see it. */
export const reportShares = pgTable(
  'report_shares',
  {
    reportId: integer('report_id')
      .notNull()
      .references(() => savedReports.id, { onDelete: 'cascade' }),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.reportId, t.personId] }), ...indexes(t.personId)],
)

export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: id(),
    reportId: integer('report_id')
      .notNull()
      .references(() => savedReports.id, { onDelete: 'cascade' }),
    frequency: text('frequency', { enum: scheduleFrequencies }).notNull(),
    recipients: jsonb('recipients').$type<string[]>().notNull().default([]),
    nextRunAt: instant('next_run_at').notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: integer('created_by')
      .notNull()
      .references(() => people.id),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    oneOf(t.frequency, scheduleFrequencies),
    index('report_schedules_due_idx').on(t.active, t.nextRunAt),
    ...indexes(t.reportId, t.createdBy),
  ],
)

/** What one unit of `fromCurrency` is worth in `toCurrency`, from a date on. */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: id(),
    fromCurrency: text('from_currency').notNull(),
    toCurrency: text('to_currency').notNull(),
    startsOn: day('starts_on').notNull(),
    rate: exchangeRate('rate').notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('exchange_rates_pair_start_key').on(t.fromCurrency, t.toCurrency, t.startsOn),
    ...currencyCode(t.fromCurrency, t.toCurrency),
    rule(t.fromCurrency, 'different_currencies', sql`${t.fromCurrency} <> ${t.toCurrency}`),
    rule(t.rate, 'rate_positive', sql`${t.rate} > 0`),
  ],
)
