import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type { DatabaseConfig } from '../config'
import * as schema from './schema'

/** The same type for embedded and real PostgreSQL, so queries cannot depend on which one it is. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export interface Database {
  db: Db
  /** Runs the pending migrations from the given folder. */
  runMigrations: (migrationsFolder: string) => Promise<void>
  close: () => Promise<void>
}

export async function openDatabase(config: DatabaseConfig): Promise<Database> {
  // Loaded on demand: production never loads the embedded database.
  if (config.kind === 'embedded') {
    const { openEmbedded } = await import('./embedded')
    return openEmbedded(config.dataDir)
  }
  const { openPostgres } = await import('./postgres')
  return openPostgres(config.url)
}
