/** Who may run the demo-data commands, and on which database. Looks at nothing but its arguments. */
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { type IsoDate, isIsoDate } from '../../shared/dates'
import { type DatabaseConfig, defaultDataDir, parseDatabaseUrl } from '../config'
import { StartupError } from '../errors'

type Env = Record<string, string | undefined>

export interface DemoCommand {
  action: 'seed' | 'reset'
  database: DatabaseConfig
  /** What the user types to confirm. Never contains a password. */
  name: string
  today: IsoDate | undefined
  confirmed: boolean
}

/** Reads the command line and settings, or throws a StartupError if the command must not run. */
export function parseDemoCommand(args: string[], env: Env): DemoCommand {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        demo: { type: 'boolean', default: false },
        today: { type: 'string' },
        yes: { type: 'boolean', default: false },
        'data-dir': { type: 'string' },
      },
    })
  } catch (error) {
    throw new StartupError(error instanceof Error ? error.message : 'Unknown command-line option.')
  }
  const { values, positionals } = parsed
  const [action] = positionals
  if (positionals.length !== 1 || (action !== 'seed' && action !== 'reset')) {
    throw new StartupError(`Unexpected argument: ${positionals.slice(action === 'seed' || action === 'reset' ? 1 : 0).join(' ')}`)
  }
  checkAllowed(env)
  const { today } = values
  if (today !== undefined && !isIsoDate(today)) {
    throw new StartupError(`--today must be a date such as 2026-11-23, not "${today}".`)
  }
  return { action, ...target(values.demo, values['data-dir'], env), today, confirmed: values.yes }
}

function checkAllowed(env: Env) {
  if (env.ALLOW_DEMO_DATA === 'true') return
  const reasons = [
    env.NODE_ENV === 'production' && 'NODE_ENV is production',
    env.DATABASE_URL?.trim() && 'DATABASE_URL is set',
  ].filter(Boolean)
  if (reasons.length === 0) return
  throw new StartupError(
    `Demo data has a known password and is refused because ${reasons.join(' and ')}. ` +
      'If this really is a database for demonstration, set ALLOW_DEMO_DATA=true.',
  )
}

function target(demo: boolean, dataDir: string | undefined, env: Env): Pick<DemoCommand, 'database' | 'name'> {
  const url = parseDatabaseUrl(env)
  if (url !== undefined) {
    if (demo) throw new StartupError('The demo uses its own embedded database. Unset DATABASE_URL to reset it.')
    if (dataDir !== undefined) throw new StartupError('--data-dir cannot be used with DATABASE_URL.')
    return { database: { kind: 'postgres', url }, name: databaseName(url) }
  }
  // As for migrations: production never falls back to an embedded database.
  if (env.NODE_ENV === 'production' && !demo && dataDir === undefined) {
    throw new StartupError('DATABASE_URL is required in production. Set it to your PostgreSQL server.')
  }
  const folder = dataDir === undefined ? defaultDataDir(demo ? 'demo' : 'development') : resolve(dataDir)
  return { database: { kind: 'embedded', dataDir: folder }, name: basename(folder) }
}

function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1)) || 'database'
  } catch {
    return 'database'
  }
}
