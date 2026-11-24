/** Building blocks shared by all tables; see docs/data-model.md for the rules they follow. */
import { getTableName, type SQL, sql } from 'drizzle-orm'
import {
  type AnyPgColumn, bigint, check, customType, date, index, integer, type PgColumn, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { fromDatabaseInteger, toDatabaseInteger } from '../numbers'

/** Generated key. Explicit values are possible, for the seed and for restoring a backup. */
export const id = () => integer('id').primaryKey().generatedByDefaultAsIdentity()

/**
 * A bigint that is a number in JavaScript. The drivers return bigint differently, and a value
 * that a number cannot hold exactly is an error, never rounded.
 */
const exactInteger = customType<{ data: number; driverData: string | number | bigint }>({
  dataType: () => 'bigint',
  toDriver: toDatabaseInteger,
  fromDriver: fromDatabaseInteger,
})

/** Minor units of a currency. */
export const money = (name: string) => exactInteger(name)
/** Integer thousandths of a minor unit. */
export const unitPrice = (name: string) => exactInteger(name)
/** Integer thousandths. */
export const quantity = (name: string) => exactInteger(name)
/** Integer thousandths of a percent: 8.25% is 8250. */
export const percent = (name: string) => integer(name)
/** Integer millionths. */
export const exchangeRate = (name: string) => exactInteger(name)
export const minutes = (name: string) => integer(name)
export const fileSize = (name: string) => bigint(name, { mode: 'number' })

/** A business date, YYYY-MM-DD in and out. */
export const day = (name: string) => date(name, { mode: 'string' })
/** A point in time. */
export const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
export const createdAt = () => instant('created_at').notNull().defaultNow()
export const updatedAt = () =>
  instant('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`)

/**
 * For stale-edit checks. Every update made through Drizzle counts up, also one that does not go
 * through `updateVersioned`.
 */
export const version = () =>
  integer('version')
    .notNull()
    .default(1)
    .$onUpdate(() => sql`"version" + 1`)

/** Binary content. */
export const bytes = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  toDriver: (value) => value,
  fromDriver: (value) => Buffer.from(value),
})

const nameFor = (columns: readonly PgColumn[], suffix: string) =>
  [getTableName((columns[0] as PgColumn).table), ...columns.map((column) => column.name), suffix].join('_')

/** One index per column. Every foreign key needs one, or deletes and joins scan the table. */
export const indexes = (...columns: [AnyPgColumn, ...AnyPgColumn[]]) =>
  columns.map((column) => index(nameFor([column], 'idx')).on(column))

/** Checks that a text column holds one of the values. */
export const oneOf = (column: AnyPgColumn, values: readonly string[]) =>
  check(nameFor([column], 'check'), sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`)

/** Checks that each column is null or at least 0. */
export const notNegative = (...columns: [AnyPgColumn, ...AnyPgColumn[]]) =>
  columns.map((column) => check(nameFor([column], 'not_negative'), sql`${column} >= 0`))

/** Checks that each column is null or a percentage from 0 to 100%. */
export const percentRange = (...columns: [AnyPgColumn, ...AnyPgColumn[]]) =>
  columns.map((column) => check(nameFor([column], 'range'), sql`${column} between 0 and 100000`))

/** Checks that each column is null or looks like an ISO 4217 code. */
export const currencyCode = (...columns: [AnyPgColumn, ...AnyPgColumn[]]) =>
  columns.map((column) => check(nameFor([column], 'format'), sql`${column} ~ '^[A-Z]{3}$'`))

/** Checks that an end date, if both are set, is not before the start date. */
export const dateOrder = (start: AnyPgColumn, end: AnyPgColumn) =>
  check(nameFor([start, end], 'order'), sql`${end} >= ${start}`)

/** Checks a condition under a name made of the table's name and the given one. */
export const rule = (column: AnyPgColumn, name: string, condition: SQL) =>
  check(`${getTableName(column.table)}_${name}`, condition)

/** Unique whatever the capitalisation. */
export const uniqueIgnoringCase = (column: AnyPgColumn) =>
  uniqueIndex(nameFor([column], 'lower_key')).on(sql`lower(${column})`)
