import { sql } from 'drizzle-orm'
import { parseDatabaseUrl } from '../config'
import { type Database, openDatabase } from '../db/database'
import { applyMigrations } from '../db/migrations'

type Env = Record<string, string | undefined>

/**
 * The PostgreSQL server for tests that need separate connections, or undefined. Everything in
 * its database is erased, so the database must be named as one for tests.
 */
export function parseTestDatabaseUrl(env: Env): string | undefined {
  const url = parseDatabaseUrl({ DATABASE_URL: env.TEST_DATABASE_URL })
  if (url === undefined) return undefined
  const name = URL.canParse(url) ? decodeURIComponent(new URL(url).pathname.slice(1)) : ''
  if (!name.includes('test')) throw new Error('TEST_DATABASE_URL must name a database with "test" in its name.')
  return url
}

/** A fresh, migrated database on that server. The caller closes it. One test file may use it. */
export async function openTestServer(url: string): Promise<Database> {
  const database = await openDatabase({ kind: 'postgres', url })
  await database.db.execute(sql`drop schema if exists public, drizzle cascade`)
  await database.db.execute(sql`create schema public`)
  await applyMigrations(database)
  return database
}
