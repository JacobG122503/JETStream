import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import { type Database, openDatabase } from '../db/database'
import { applyMigrations } from '../db/migrations'
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
