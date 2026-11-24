/**
 * Weekly submissions. Each time entry and expense also has its own status, because one week can
 * span several approvers.
 */
import { integer, pgTable, text, unique } from 'drizzle-orm/pg-core'
import { approvalActions, submissionStatuses } from '../../../shared/domain'
import { createdAt, dateOrder, day, id, indexes, instant, oneOf, updatedAt, version } from './columns'
import { people } from './people'

export const submissions = pgTable(
  'submissions',
  {
    id: id(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id),
    periodStart: day('period_start').notNull(),
    periodEnd: day('period_end').notNull(),
    status: text('status', { enum: submissionStatuses }).notNull(),
    submittedAt: instant('submitted_at').notNull().defaultNow(),
    /** Of the decision. */
    comment: text('comment').notNull().default(''),
    decidedBy: integer('decided_by').references(() => people.id),
    decidedAt: instant('decided_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('submissions_person_period_key').on(t.personId, t.periodStart),
    dateOrder(t.periodStart, t.periodEnd),
    oneOf(t.status, submissionStatuses),
    ...indexes(t.decidedBy, t.periodStart),
  ],
)

/** What happened to a person's period, never changed afterwards. */
export const approvalEvents = pgTable(
  'approval_events',
  {
    id: id(),
    submissionId: integer('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    actorId: integer('actor_id')
      .notNull()
      .references(() => people.id),
    action: text('action', { enum: approvalActions }).notNull(),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [oneOf(t.action, approvalActions), ...indexes(t.submissionId, t.actorId)],
)

/** A locked period an administrator opened again for one person. Lock settings: company_settings. */
export const periodUnlocks = pgTable(
  'period_unlocks',
  {
    id: id(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    periodStart: day('period_start').notNull(),
    periodEnd: day('period_end').notNull(),
    reason: text('reason').notNull().default(''),
    unlockedBy: integer('unlocked_by')
      .notNull()
      .references(() => people.id),
    expiresAt: instant('expires_at'),
    createdAt: createdAt(),
  },
  (t) => [dateOrder(t.periodStart, t.periodEnd), ...indexes(t.personId, t.unlockedBy)],
)
