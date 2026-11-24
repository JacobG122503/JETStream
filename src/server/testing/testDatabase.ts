import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { SQL } from 'drizzle-orm'
import { onTestFinished } from 'vitest'
import { type Database, type Db, openDatabase } from '../db/database'
import { applyMigrations } from '../db/migrations'
import { errorCode } from '../errors'
import { dataRoot } from '../paths'

/** A fresh, migrated, in-memory database. The caller closes it. */
export async function createTestDatabase(): Promise<Database> {
  const database = await openDatabase({ kind: 'embedded', dataDir: 'memory://' })
  await applyMigrations(database)
  return database
}

/** A new folder inside the project, deleted when the current test ends. */
export async function createTempDir(): Promise<string> {
  const parent = join(dataRoot, 'tmp')
  await mkdir(parent, { recursive: true })
  const dir = await mkdtemp(join(parent, 'test-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** The SQLSTATE a query fails with. */
export async function sqlState(action: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await action
  } catch (error) {
    return errorCode(error) ?? String(error)
  }
  throw new Error('Expected the query to fail')
}

/** The rows of a raw query, which both drivers return in the same place. */
export async function queryRows<T>(db: Db, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as { rows: T[] }).rows
}
