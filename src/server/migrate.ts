// Applies pending migrations: to DATABASE_URL, or to the development database without one.
import { type DatabaseConfig, defaultDataDir, parseDatabaseUrl } from './config'
import { openDatabase } from './db/database'
import { applyMigrations } from './db/migrations'
import { StartupError } from './errors'

function target(): DatabaseConfig {
  const url = parseDatabaseUrl(process.env)
  if (url) return { kind: 'postgres', url }
  if (process.env.NODE_ENV === 'production') {
    throw new StartupError('DATABASE_URL is required in production. Set it to your PostgreSQL server.')
  }
  return { kind: 'embedded', dataDir: defaultDataDir('development') }
}

try {
  const config = target()
  const name =
    config.kind === 'embedded' ? `the development database in ${config.dataDir}` : 'the database in DATABASE_URL'
  const database = await openDatabase(config)
  try {
    const count = await applyMigrations(database)
    console.log(count === 0 ? `No pending migrations for ${name}.` : `Applied ${count} migration(s) to ${name}.`)
  } finally {
    await database.close()
  }
} catch (error) {
  console.error(error instanceof StartupError ? `JET Time: ${error.message}` : error)
  process.exitCode = 1
}
