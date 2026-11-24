/**
 * Signing in. Passwords are salted hashes, tokens and recovery codes are hashes, and the TOTP
 * secret is ciphertext: nothing here lets a reader of the database sign in.
 */
import { sql } from 'drizzle-orm'
import {
  bigint, boolean, index, integer, pgTable, primaryKey, text, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { clients } from './clients'
import { createdAt, id, indexes, instant, updatedAt, version } from './columns'
import { people, roles } from './people'
import { projects } from './projects'

export const personCredentials = pgTable('person_credentials', {
  personId: integer('person_id')
    .primaryKey()
    .references(() => people.id, { onDelete: 'cascade' }),
  /** Self-describing: names the algorithm, its parameters, the salt and the hash. */
  passwordHash: text('password_hash').notNull(),
  changedAt: instant('changed_at').notNull().defaultNow(),
})

export const personTotp = pgTable('person_totp', {
  personId: integer('person_id')
    .primaryKey()
    .references(() => people.id, { onDelete: 'cascade' }),
  secretCiphertext: text('secret_ciphertext').notNull(),
  /** Null until a first code was accepted. */
  confirmedAt: instant('confirmed_at'),
  /** The last accepted time step, so that no code works twice. */
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const personRecoveryCodes = pgTable(
  'person_recovery_codes',
  {
    id: id(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: instant('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('person_recovery_codes_person_code_key').on(t.personId, t.codeHash)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    /** "Keep me signed in". */
    persistent: boolean('persistent').notNull().default(false),
    userAgent: text('user_agent'),
    address: text('address'),
    createdAt: createdAt(),
    lastUsedAt: instant('last_used_at').notNull().defaultNow(),
    expiresAt: instant('expires_at').notNull(),
  },
  (t) => indexes(t.personId, t.expiresAt),
)

export const invites = pgTable(
  'invites',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id),
    /** Set when an existing person without a password is invited, and when an invite is accepted. */
    personId: integer('person_id').references(() => people.id),
    createdBy: integer('created_by')
      .notNull()
      .references(() => people.id),
    expiresAt: instant('expires_at').notNull(),
    acceptedAt: instant('accepted_at'),
    revokedAt: instant('revoked_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('invites_open_email_key')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    ...indexes(t.roleId, t.personId, t.createdBy),
  ],
)

export const inviteClients = pgTable(
  'invite_clients',
  {
    inviteId: integer('invite_id')
      .notNull()
      .references(() => invites.id, { onDelete: 'cascade' }),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.inviteId, t.clientId] }), ...indexes(t.clientId)],
)

export const inviteProjects = pgTable(
  'invite_projects',
  {
    inviteId: integer('invite_id')
      .notNull()
      .references(() => invites.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.inviteId, t.projectId] }), ...indexes(t.projectId)],
)

export const passwordResets = pgTable(
  'password_resets',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    createdBy: integer('created_by').references(() => people.id),
    expiresAt: instant('expires_at').notNull(),
    usedAt: instant('used_at'),
    revokedAt: instant('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => indexes(t.personId, t.createdBy),
)

/** For limiting guesses. Addresses without an account count alike. */
export const signInAttempts = pgTable(
  'sign_in_attempts',
  {
    id: id(),
    /** What is being limited, such as sign_in or sign_up (004). */
    kind: text('kind').notNull().default('sign_in'),
    /** In lower case. */
    email: text('email').notNull(),
    address: text('address').notNull(),
    succeeded: boolean('succeeded').notNull(),
    attemptedAt: instant('attempted_at').notNull().defaultNow(),
  },
  (t) => [
    index('sign_in_attempts_email_idx').on(t.email, t.attemptedAt),
    index('sign_in_attempts_address_idx').on(t.address, t.attemptedAt),
    index('sign_in_attempts_time_idx').on(t.attemptedAt),
  ],
)
