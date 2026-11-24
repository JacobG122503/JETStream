import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { errorCode, StartupError, withTimeout } from '../errors'
import type { Database } from './database'
import * as schema from './schema'

// Connection problems are reported by code only. Messages can repeat parts of a mistyped
// DATABASE_URL, and so the password.
const hints: Record<string, string> = {
  ECONNREFUSED: 'nothing is listening at that address',
  ENOTFOUND: 'the host name was not found',
  '28P01': 'the user name or password was not accepted',
  '28000': 'the user is not allowed to connect',
  '3D000': 'the database does not exist',
}

function connectionError(error: unknown) {
  const code = errorCode(error)
  const hint = code ? hints[code] : undefined
  const reason = [code ?? 'no answer, or not a valid address', hint].filter(Boolean).join(': ')
  return new StartupError(`Cannot connect to the database in DATABASE_URL (${reason}).`)
}

export async function openPostgres(url: string): Promise<Database> {
  let pool: pg.Pool
  try {
    pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000 })
  } catch (error) {
    throw connectionError(error)
  }
  // Without a listener, losing an idle connection would stop the process.
  pool.on('error', (error) => {
    console.error(`Database connection lost (${errorCode(error) ?? error.name}).`)
  })
  try {
    await withTimeout(pool.query('select 1'), 10_000, 'timed out')
  } catch (error) {
    void pool.end().catch(() => undefined)
    throw connectionError(error)
  }
  const db = drizzle(pool, { schema })
  return {
    db,
    runMigrations: (migrationsFolder) => migrate(db, { migrationsFolder }),
    close: () => pool.end(),
  }
}
