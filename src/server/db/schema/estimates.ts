import { index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { estimateAnswers, estimateStatuses, messageKinds } from '../../../shared/domain'
import { createdAt, day, id, indexes, instant, oneOf, updatedAt, version } from './columns'
import { documentColumns, documentRules, lineColumns, totalColumns, totalRules } from './documents'
import { invoices } from './invoices'
import { people } from './people'
import { projects } from './projects'

export const estimates = pgTable(
  'estimates',
  {
    id: id(),
    number: text('number').notNull().unique(),
    ...documentColumns(),
    status: text('status', { enum: estimateStatuses }).notNull().default('draft'),
    issuedOn: day('issued_on').notNull(),
    expiresOn: day('expires_on'),
    ...totalColumns(),
    sentAt: instant('sent_at'),
    /** What was made from it. */
    invoiceId: integer('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
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
    oneOf(t.status, estimateStatuses),
    index('estimates_status_idx').on(t.status, t.issuedOn),
    ...indexes(t.clientId, t.invoiceId, t.projectId, t.createdBy),
  ],
)

export const estimateLines = pgTable(
  'estimate_lines',
  {
    ...lineColumns(),
    estimateId: integer('estimate_id')
      .notNull()
      .references(() => estimates.id, { onDelete: 'cascade' }),
  },
  (t) => [index('estimate_lines_estimate_idx').on(t.estimateId, t.position), ...indexes(t.categoryId, t.projectId)],
)

export const estimateMessages = pgTable(
  'estimate_messages',
  {
    id: id(),
    estimateId: integer('estimate_id')
      .notNull()
      .references(() => estimates.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: messageKinds }).notNull(),
    senderId: integer('sender_id').references(() => people.id),
    recipients: jsonb('recipients').$type<{ name: string; email: string }[]>().notNull().default([]),
    subject: text('subject').notNull().default(''),
    body: text('body').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [oneOf(t.kind, messageKinds), ...indexes(t.estimateId, t.senderId)],
)

/** Links a client opens without an account; only the hash is kept. */
export const estimateLinks = pgTable(
  'estimate_links',
  {
    id: id(),
    estimateId: integer('estimate_id')
      .notNull()
      .references(() => estimates.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: integer('created_by').references(() => people.id),
    revokedAt: instant('revoked_at'),
    lastViewedAt: instant('last_viewed_at'),
    createdAt: createdAt(),
  },
  (t) => indexes(t.estimateId, t.createdBy),
)

/** What the client answered, through a link or as recorded by a person. */
export const estimateAnswerRecords = pgTable(
  'estimate_answers',
  {
    id: id(),
    estimateId: integer('estimate_id')
      .notNull()
      .references(() => estimates.id, { onDelete: 'cascade' }),
    answer: text('answer', { enum: estimateAnswers }).notNull(),
    name: text('name').notNull().default(''),
    comment: text('comment').notNull().default(''),
    linkId: integer('link_id').references(() => estimateLinks.id, { onDelete: 'set null' }),
    recordedBy: integer('recorded_by').references(() => people.id),
    answeredAt: instant('answered_at').notNull().defaultNow(),
  },
  (t) => [oneOf(t.answer, estimateAnswers), ...indexes(t.estimateId, t.linkId, t.recordedBy)],
)
