/** People and what describes them. Rates are dated; time entries store none. */
import { sql } from 'drizzle-orm'
import { type AnyPgColumn, boolean, integer, jsonb, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core'
import { personKinds, personStatuses, rateKinds } from '../../../shared/domain'
import { clients } from './clients'
import {
  bytes, createdAt, day, fileSize, id, indexes, minutes, money, notNegative, oneOf, rule, uniqueIgnoringCase,
  updatedAt, version,
} from './columns'

export const roles = pgTable(
  'roles',
  {
    id: id(),
    /** Identifies a built-in role in code; null for roles made by an administrator. */
    key: text('key').unique(),
    name: text('name').notNull(),
    builtIn: boolean('built_in').notNull().default(false),
    /** Names from the permission catalogue (005). */
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIgnoringCase(t.name),
    rule(t.permissions, 'permissions_list', sql`jsonb_typeof(${t.permissions}) = 'array'`),
  ],
)

export const people = pgTable(
  'people',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    status: text('status', { enum: personStatuses }).notNull(),
    kind: text('kind', { enum: personKinds }).notNull().default('employee'),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id),
    weeklyCapacityMinutes: minutes('weekly_capacity_minutes').notNull().default(2400),
    /** IANA name; null means the company time zone. */
    timeZone: text('time_zone'),
    photoFileId: integer('photo_file_id').references((): AnyPgColumn => files.id),
    startedOn: day('started_on'),
    archivedOn: day('archived_on'),
    notes: text('notes'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIgnoringCase(t.email),
    oneOf(t.status, personStatuses),
    oneOf(t.kind, personKinds),
    rule(t.weeklyCapacityMinutes, 'weekly_capacity_range', sql`${t.weeklyCapacityMinutes} between 0 and 10080`),
    rule(t.archivedOn, 'archived_on_only_if_archived', sql`${t.archivedOn} is null or ${t.status} = 'archived'`),
    ...indexes(t.roleId, t.photoFileId),
  ],
)

/** Uploaded content. Kept here so that one database backup is complete. */
export const files = pgTable(
  'files',
  {
    id: id(),
    name: text('name').notNull(),
    mediaType: text('media_type').notNull(),
    sizeBytes: fileSize('size_bytes').notNull(),
    content: bytes('content').notNull(),
    /** Null for files of the company, such as the logo. */
    ownerId: integer('owner_id').references((): AnyPgColumn => people.id),
    createdAt: createdAt(),
  },
  (t) => [rule(t.sizeBytes, 'size_matches', sql`${t.sizeBytes} = octet_length(${t.content})`), ...indexes(t.ownerId)],
)

/** Descriptive labels, such as Engineer or Technician. */
export const labels = pgTable(
  'labels',
  { id: id(), name: text('name').notNull(), version: version(), createdAt: createdAt(), updatedAt: updatedAt() },
  (t) => [uniqueIgnoringCase(t.name)],
)

export const personLabels = pgTable(
  'person_labels',
  {
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    labelId: integer('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.personId, t.labelId] }), ...indexes(t.labelId)],
)

/** What an hour of a person is billed at or costs, from a date on, in company currency. */
export const personRates = pgTable(
  'person_rates',
  {
    id: id(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: rateKinds }).notNull(),
    startsOn: day('starts_on').notNull(),
    rate: money('rate').notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('person_rates_person_kind_start_key').on(t.personId, t.kind, t.startsOn),
    oneOf(t.kind, rateKinds),
    ...notNegative(t.rate),
  ],
)

/** Who manages whom. */
export const personManagers = pgTable(
  'person_managers',
  {
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    managerId: integer('manager_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.managerId] }),
    rule(t.personId, 'not_self', sql`${t.personId} <> ${t.managerId}`),
    ...indexes(t.managerId),
  ],
)

/** Client companies a person is assigned to. */
export const personClients = pgTable(
  'person_clients',
  {
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.clientId] }), ...indexes(t.clientId)],
)
