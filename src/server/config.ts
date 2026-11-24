import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { StartupError } from './errors'
import { dataRoot } from './paths'

/**
 * Production unless `--dev` or `--demo` is passed. A command-line flag rather than an
 * environment variable, so a stray setting cannot turn a production server into a demo.
 */
export type Mode = 'development' | 'demo' | 'production'

export type DatabaseConfig =
  | { kind: 'postgres'; url: string }
  /** `dataDir` is a folder, or `memory://` for a database that lasts as long as the process. */
  | { kind: 'embedded'; dataDir: string }

export interface ServerConfig {
  mode: Mode
  host: string
  port: number
  /** Always starts and ends with "/". */
  basePath: string
  database: DatabaseConfig
}

type Env = Record<string, string | undefined>

export function parsePort(value = '3000'): number {
  const port = /^\d+$/.test(value) ? Number(value) : NaN
  if (!(port >= 1 && port <= 65535)) {
    throw new StartupError(`PORT must be a whole number from 1 to 65535, not "${value}".`)
  }
  return port
}

export function parseBasePath(value = '/'): string {
  if (!value.startsWith('/')) {
    throw new StartupError(`BASE_PATH must start with "/" (for example /jettime), not "${value}".`)
  }
  const path = value.replace(/\/$/, '')
  // The path goes into HTML and routes, so only plain URL characters are accepted.
  if (path !== '' && !/^(\/(?!\.{1,2}(\/|$))[\w.~-]+)+$/.test(path)) {
    throw new StartupError(
      `BASE_PATH may only contain letters, digits, ".", "_", "~" and "-" between slashes, not "${value}".`,
    )
  }
  return `${path}/`
}

export function parseDatabaseUrl(env: Env): string | undefined {
  const url = env.DATABASE_URL?.trim()
  if (!url) return undefined
  // The value is never repeated in messages: it contains the password.
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new StartupError('DATABASE_URL must start with postgres:// or postgresql://.')
  }
  return url
}

function parseMode(dev: boolean, demo: boolean, env: Env): Mode {
  if (dev && demo) throw new StartupError('Choose either --dev or --demo, not both.')
  if (dev && env.NODE_ENV === 'production') {
    throw new StartupError('--dev cannot be used with NODE_ENV=production.')
  }
  return dev ? 'development' : demo ? 'demo' : 'production'
}

function parseDatabase(mode: Mode, dataDir: string | undefined, env: Env): DatabaseConfig {
  if (mode === 'production') {
    if (dataDir !== undefined) throw new StartupError('--data-dir is only for --dev and --demo.')
    const url = parseDatabaseUrl(env)
    if (!url) throw new StartupError('DATABASE_URL is required in production. Set it to your PostgreSQL server.')
    return { kind: 'postgres', url }
  }
  if (mode === 'demo' && env.DATABASE_URL?.trim()) {
    throw new StartupError('Demo mode uses its own embedded database. Unset DATABASE_URL to run the demo.')
  }
  if (dataDir === undefined) return { kind: 'embedded', dataDir: defaultDataDir(mode) }
  return { kind: 'embedded', dataDir: dataDir === 'memory://' ? dataDir : resolve(dataDir) }
}

export function defaultDataDir(mode: 'development' | 'demo'): string {
  return join(dataRoot, mode === 'demo' ? 'demo' : 'dev')
}

/** Reads the configuration, or throws a StartupError naming the setting that is wrong. */
export function loadConfig(args: string[], env: Env): ServerConfig {
  let values
  try {
    ;({ values } = parseArgs({
      args,
      options: {
        dev: { type: 'boolean', default: false },
        demo: { type: 'boolean', default: false },
        'data-dir': { type: 'string' },
      },
    }))
  } catch (error) {
    throw new StartupError(error instanceof Error ? error.message : 'Unknown command-line option.')
  }
  const mode = parseMode(values.dev ?? false, values.demo ?? false, env)
  return {
    mode,
    host: env.HOST || '127.0.0.1',
    port: parsePort(env.PORT),
    basePath: parseBasePath(env.BASE_PATH),
    database: parseDatabase(mode, values['data-dir'], env),
  }
}
