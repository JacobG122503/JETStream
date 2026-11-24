import { boolean, index, integer, jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core'
import { deliveryStatuses } from '../../../shared/domain'
import { createdAt, id, indexes, instant, notNegative, oneOf, updatedAt, version } from './columns'
import { people } from './people'

/** Personal API tokens; only the hash is kept. */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: id(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    /** The first characters, to recognise it by. */
    hint: text('hint').notNull().default(''),
    expiresAt: instant('expires_at'),
    lastUsedAt: instant('last_used_at'),
    revokedAt: instant('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => indexes(t.personId),
)

export const webhooks = pgTable(
  'webhooks',
  {
    id: id(),
    url: text('url').notNull(),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    secretCiphertext: text('secret_ciphertext').notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: integer('created_by')
      .notNull()
      .references(() => people.id),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => indexes(t.createdBy),
)

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    webhookId: integer('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: deliveryStatuses }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    error: text('error'),
    nextAttemptAt: instant('next_attempt_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    oneOf(t.status, deliveryStatuses),
    ...notNegative(t.attempts),
    index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    ...indexes(t.webhookId),
  ],
)

/** An account at the company's sign-on provider that belongs to a person. */
export const ssoIdentities = pgTable(
  'sso_identities',
  {
    id: id(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    email: text('email'),
    lastUsedAt: instant('last_used_at'),
    createdAt: createdAt(),
  },
  (t) => [unique('sso_identities_issuer_subject_key').on(t.issuer, t.subject), ...indexes(t.personId)],
)
