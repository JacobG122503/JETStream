import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { StartupError } from '../errors'
import { lockDataDir } from './dataDirLock'
import type { Database } from './database'
import * as schema from './schema'

/** Opens PGlite. It has a single connection, so overlapping transactions run one after another. */
export async function openEmbedded(dataDir: string): Promise<Database> {
  let unlock = () => Promise.resolve()
  if (dataDir !== 'memory://') {
    await mkdir(dirname(dataDir), { recursive: true })
    unlock = await lockDataDir(dataDir)
  }
  let client: PGlite
  try {
    client = await PGlite.create(dataDir)
  } catch (error) {
    await unlock()
    console.error(error)
    throw new StartupError(`Cannot open the embedded database in ${dataDir}. Delete that folder to start afresh.`)
  }
  const db = drizzle(client, { schema })
  return {
    db,
    runMigrations: (migrationsFolder) => migrate(db, { migrationsFolder }),
    close: async () => {
      await client.close()
      await unlock()
    },
  }
}
