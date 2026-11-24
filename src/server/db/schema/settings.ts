import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import {
  currencyPlacements, dateFormats, hourFormats, numberFormats, paymentTerms, roundingIncrements, roundingModes,
  timeFormats, timeModes,
} from '../../../shared/domain'
import {
  createdAt, currencyCode, day, id, indexes, notNegative, oneOf, percent, percentRange, rule, updatedAt, version,
} from './columns'
import { files, people } from './people'

/** The one company. The key allows no second row. */
export const companySettings = pgTable(
  'company_settings',
  {
    id: integer('id').primaryKey().default(1),
    name: text('name').notNull().default('JET Engineering'),
    address: text('address').notNull().default(''),
    logoFileId: integer('logo_file_id').references(() => files.id),
    currency: text('currency').notNull().default('USD'),
    timeZone: text('time_zone').notNull().default('America/Chicago'),
    /** 0 is Sunday, 1 Monday. */
    weekStartsOn: integer('week_starts_on').notNull().default(1),
    /** 1 is January. */
    fiscalYearStartMonth: integer('fiscal_year_start_month').notNull().default(1),

    dateFormat: text('date_format', { enum: dateFormats }).notNull().default('mdy'),
    timeFormat: text('time_format', { enum: timeFormats }).notNull().default('12h'),
    numberFormat: text('number_format', { enum: numberFormats }).notNull().default('1,234.56'),
    currencyPlacement: text('currency_placement', { enum: currencyPlacements }).notNull().default('symbol_before'),
    hourFormat: text('hour_format', { enum: hourFormats }).notNull().default('decimal'),

    timeMode: text('time_mode', { enum: timeModes }).notNull().default('duration'),
    roundingMode: text('rounding_mode', { enum: roundingModes }).notNull().default('off'),
    roundingMinutes: integer('rounding_minutes').$type<(typeof roundingIncrements)[number]>().notNull().default(15),
    timeNotesRequired: boolean('time_notes_required').notNull().default(false),
    expenseNotesRequired: boolean('expense_notes_required').notNull().default(false),

    signUpEnabled: boolean('sign_up_enabled').notNull().default(true),
    approvalEnabled: boolean('approval_enabled').notNull().default(true),
    /** Locks a week this many days after it ends; null for no automatic lock. */
    lockAfterDays: integer('lock_after_days'),
    /** Locks everything up to this date. */
    lockedThrough: day('locked_through'),

    expensesEnabled: boolean('expenses_enabled').notNull().default(true),
    invoicesEnabled: boolean('invoices_enabled').notNull().default(true),
    estimatesEnabled: boolean('estimates_enabled').notNull().default(true),
    timeOffEnabled: boolean('time_off_enabled').notNull().default(true),
    schedulingEnabled: boolean('scheduling_enabled').notNull().default(true),

    /** Defaults for invoices and estimates of clients without their own. */
    tax1Name: text('tax1_name'),
    tax1Percent: percent('tax1_percent'),
    tax2Name: text('tax2_name'),
    tax2Percent: percent('tax2_percent'),
    paymentTerms: text('payment_terms', { enum: paymentTerms }).notNull().default('net_30'),
    paymentTermDays: integer('payment_term_days'),
    invoiceNotes: text('invoice_notes').notNull().default(''),
    estimateNotes: text('estimate_notes').notNull().default(''),
    /** How long an estimate stays open. */
    estimateValidDays: integer('estimate_valid_days').notNull().default(30),
    /** Days after the due date on which late reminders go out. */
    reminderDays: jsonb('reminder_days').$type<number[]>().notNull().default([]),

    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    rule(t.id, 'single_row', sql`${t.id} = 1`),
    ...currencyCode(t.currency),
    rule(t.weekStartsOn, 'week_starts_on_range', sql`${t.weekStartsOn} between 0 and 6`),
    rule(t.fiscalYearStartMonth, 'fiscal_year_range', sql`${t.fiscalYearStartMonth} between 1 and 12`),
    oneOf(t.dateFormat, dateFormats),
    oneOf(t.timeFormat, timeFormats),
    oneOf(t.numberFormat, numberFormats),
    oneOf(t.currencyPlacement, currencyPlacements),
    oneOf(t.hourFormat, hourFormats),
    oneOf(t.timeMode, timeModes),
    oneOf(t.roundingMode, roundingModes),
    rule(t.roundingMinutes, 'rounding_minutes_check', sql`${t.roundingMinutes} in (${sql.raw(roundingIncrements.join(', '))})`),
    ...notNegative(t.lockAfterDays, t.estimateValidDays, t.paymentTermDays),
    ...percentRange(t.tax1Percent, t.tax2Percent),
    oneOf(t.paymentTerms, paymentTerms),
    rule(t.paymentTerms, 'custom_terms', sql`(${t.paymentTerms} = 'custom') = (${t.paymentTermDays} is not null)`),
    rule(t.reminderDays, 'reminder_days_list', sql`jsonb_typeof(${t.reminderDays}) = 'array'`),
    ...indexes(t.logoFileId),
  ],
)

/** Who changed what and when. Never changed, and it outlives what it is about. */
export const activityLog = pgTable(
  'activity_log',
  {
    id: id(),
    /** Null for the system itself, such as a scheduled job. */
    actorId: integer('actor_id').references(() => people.id),
    /** Such as created, updated, approved. */
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: integer('subject_id'),
    summary: text('summary').notNull(),
    /** Old and new values of what changed. */
    changes: jsonb('changes').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('activity_log_time_idx').on(t.createdAt),
    index('activity_log_subject_idx').on(t.subjectType, t.subjectId),
    index('activity_log_actor_idx').on(t.actorId, t.createdAt),
  ],
)
