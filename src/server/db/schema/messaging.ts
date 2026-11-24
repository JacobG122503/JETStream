import { boolean, index, integer, jsonb, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core'
import { jobStatuses, outboxStatuses } from '../../../shared/domain'
import { createdAt, id, indexes, instant, notNegative, oneOf, updatedAt, version } from './columns'
import { people } from './people'

/** In-app notifications. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    /** Such as timesheet_reminder or invoice_late (018). */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** In-app path to open. */
    path: text('path'),
    readAt: instant('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_person_idx').on(t.personId, t.createdAt)],
)

/** A person's choice for a kind of notification; without a row the defaults of 018 apply. */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    inApp: boolean('in_app').notNull().default(true),
    email: boolean('email').notNull().default(true),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.kind] })],
)

/** Every email. `captured` means no email service is configured and nothing was sent. */
export const outboxMessages = pgTable(
  'outbox_messages',
  {
    id: id(),
    kind: text('kind').notNull(),
    status: text('status', { enum: outboxStatuses }).notNull(),
    recipients: jsonb('recipients').$type<{ name: string; email: string }[]>().notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    /** What it is about, such as invoice 12. */
    subjectType: text('subject_type'),
    subjectId: integer('subject_id'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdBy: integer('created_by').references(() => people.id),
    sentAt: instant('sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    oneOf(t.status, outboxStatuses),
    ...notNegative(t.attempts),
    index('outbox_messages_status_idx').on(t.status, t.createdAt),
    index('outbox_messages_subject_idx').on(t.subjectType, t.subjectId),
    ...indexes(t.createdBy),
  ],
)

/** Wording changed by an administrator; without a row the built-in wording is used. */
export const messageTemplates = pgTable('message_templates', {
  id: id(),
  key: text('key').notNull().unique(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Runs of scheduled jobs. The key lets each due run happen once, also after restarts. */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: id(),
    job: text('job').notNull(),
    dueAt: instant('due_at').notNull(),
    status: text('status', { enum: jobStatuses }).notNull(),
    attempts: integer('attempts').notNull().default(1),
    error: text('error'),
    startedAt: instant('started_at').notNull().defaultNow(),
    finishedAt: instant('finished_at'),
  },
  (t) => [unique('job_runs_job_due_key').on(t.job, t.dueAt), oneOf(t.status, jobStatuses), ...notNegative(t.attempts)],
)
