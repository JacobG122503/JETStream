import { readMigrationFiles } from 'drizzle-orm/migrator'
import { bigint, pgSchema } from 'drizzle-orm/pg-core'
import { errorCode, StartupError } from '../errors'
import { migrationsDir } from '../paths'
import type { Database, Db } from './database'

/** Drizzle's own record of applied migrations. */
const applied = pgSchema('drizzle').table('__drizzle_migrations', {
  createdAt: bigint('created_at', { mode: 'number' }),
})

const undefinedTable = '42P01'

/** How many migration files have not been applied. Only reads. */
export async function countPendingMigrations(db: Db, folder = migrationsDir): Promise<number> {
  const files = readMigrationFiles({ migrationsFolder: folder })
  let rows: { createdAt: number | null }[]
  try {
    rows = await db.select().from(applied)
  } catch (error) {
    if (errorCode(error) !== undefinedTable) throw error
    rows = []
  }
  const done = new Set(rows.map((row) => row.createdAt))
  return files.filter((file) => !done.has(file.folderMillis)).length
}

/** Applies the pending migrations and returns how many there were. */
export async function applyMigrations(database: Database, folder = migrationsDir): Promise<number> {
  const pending = await countPendingMigrations(database.db, folder)
  if (pending === 0) return 0
  await database.runMigrations(folder)
  // Drizzle skips a migration dated before the last applied one, for example after a merge.
  const skipped = await countPendingMigrations(database.db, folder)
  if (skipped > 0) {
    throw new StartupError(
      `${skipped} migration(s) in ${folder} are older than the last applied one and were skipped. ` +
        'Delete them and create them again with npm run db:generate.',
    )
  }
  return pending
}
