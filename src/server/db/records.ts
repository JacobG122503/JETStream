/** Changing records without losing someone else's change. */
import { and, eq, type InferSelectModel, sql } from 'drizzle-orm'
import type { PgColumn, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core'
import type { Db, Tx } from './database'

/** The record does not exist (any more). */
export class NotFoundError extends Error {
  override name = 'NotFoundError'
  constructor(readonly recordId: number) {
    super(`There is no record ${recordId}.`)
  }
}

/** Someone else changed the record since the caller read it. */
export class StaleError extends Error {
  override name = 'StaleError'
  constructor(
    readonly recordId: number,
    readonly expectedVersion: number,
  ) {
    super(`Record ${recordId} has changed since version ${expectedVersion}.`)
  }
}

export type VersionedTable = PgTable & { id: PgColumn; version: PgColumn }
type Values<T extends PgTable> = PgUpdateSetSource<T> & { id?: never; version?: never }

/**
 * Updates a record only if it still has the version the caller read, and counts the version up.
 * Otherwise nothing changes and a StaleError or NotFoundError is thrown.
 */
export async function updateVersioned<T extends VersionedTable>(
  db: Db | Tx,
  table: T,
  id: number,
  expectedVersion: number,
  values: Values<T>,
): Promise<InferSelectModel<T>> {
  // Drizzle cannot relate a generic table to its own columns.
  const untyped: VersionedTable = table
  const rows = await db
    .update(untyped)
    .set({ ...values, version: sql`${untyped.version} + 1` } as Record<string, unknown>)
    .where(and(eq(untyped.id, id), eq(untyped.version, expectedVersion)))
    .returning()
  const [row] = rows as InferSelectModel<T>[]
  if (row) return row
  const exists = await db.select({ id: untyped.id }).from(untyped).where(eq(untyped.id, id))
  throw exists.length > 0 ? new StaleError(id, expectedVersion) : new NotFoundError(id)
}
