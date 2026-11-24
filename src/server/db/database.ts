import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { DatabaseConfig } from '../config'
import * as schema from './schema'

type Schema = typeof schema
/** The same type for embedded and real PostgreSQL, so queries cannot depend on which one it is. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>
/** A transaction. Functions that need to run inside their caller's transaction take one. */
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>

export interface Database {
  db: Db
  /** Runs the pending migrations from the given folder. */
  runMigrations: (migrationsFolder: string) => Promise<void>
  close: () => Promise<void>
}

export interface OpenOptions {
  /** How long to wait for another process to let go of an embedded database. */
  lockWaitMs?: number
}

export async function openDatabase(config: DatabaseConfig, options: OpenOptions = {}): Promise<Database> {
  // Loaded on demand: production never loads the embedded database.
  if (config.kind === 'embedded') {
    const { openEmbedded } = await import('./embedded')
    return openEmbedded(config.dataDir, options.lockWaitMs)
  }
  const { openPostgres } = await import('./postgres')
  return openPostgres(config.url)
}
