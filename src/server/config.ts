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
  /** The address people use, ending with the base path. */
  publicUrl: string
  /** Number of reverse proxies in front. */
  trustProxy: number
  /** What to tell whoever starts the server about these settings. */
  warnings: string[]
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

export function parseTrustProxy(value = '0'): number {
  if (!/^[0-5]$/.test(value)) {
    throw new StartupError(`TRUST_PROXY must be a whole number from 0 to 5, not "${value}".`)
  }
  return Number(value)
}

/** Whether only this computer can reach the host. */
export function isLoopback(host: string): boolean {
  return /^(localhost|\[?::1\]?|127(\.\d{1,3}){3})$/i.test(host)
}

export function serverUrl({ host, port, basePath }: Pick<ServerConfig, 'host' | 'port' | 'basePath'>) {
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}${basePath}`
}

type Listen = Pick<ServerConfig, 'mode' | 'host' | 'port' | 'basePath'>

/** Never repeats the value: it could hold a password by mistake. */
function parsePublicUrl(env: Env, listen: Listen): string {
  const { mode, basePath } = listen
  const value = env.PUBLIC_URL?.trim()
  if (!value) {
    if (mode !== 'production') return serverUrl(listen)
    throw new StartupError('PUBLIC_URL is required in production. Set it to the address people use, such as https://time.example.com/.')
  }
  const url = /^https?:\/\//i.test(value) && URL.canParse(value) ? new URL(value) : undefined
  if (!url || url.username || url.password || url.search || url.hash) {
    throw new StartupError('PUBLIC_URL must be an absolute http or https address without a user name, query or fragment.')
  }
  if (`${url.pathname.replace(/\/$/, '')}/` !== basePath) {
    throw new StartupError(`The path of PUBLIC_URL must equal BASE_PATH (${basePath}).`)
  }
  if (mode === 'production' && url.protocol === 'http:' && !isLoopback(url.hostname) && env.ALLOW_INSECURE_HTTP !== 'true') {
    throw new StartupError(
      'PUBLIC_URL must start with https://, or passwords travel unprotected. To accept that, set ALLOW_INSECURE_HTTP=true.',
    )
  }
  return `${url.origin}${basePath}`
}

function configWarnings(env: Env, { mode, host }: Listen): string[] {
  const warnings: string[] = []
  if (mode === 'production' && env.ALLOW_INSECURE_HTTP === 'true') {
    warnings.push('WARNING: ALLOW_INSECURE_HTTP is on. Passwords and sessions may travel over the network unprotected.')
  }
  if (mode === 'demo' && !isLoopback(host)) {
    warnings.push(`WARNING: demo mode listens on HOST ${host}. Anyone who reaches it can sign in as a demo account.`)
  }
  return warnings
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
  const database = parseDatabase(mode, values['data-dir'], env)
  const listen = {
    mode,
    host: env.HOST || '127.0.0.1',
    port: parsePort(env.PORT),
    basePath: parseBasePath(env.BASE_PATH),
  }
  return {
    ...listen,
    database,
    publicUrl: parsePublicUrl(env, listen),
    trustProxy: parseTrustProxy(env.TRUST_PROXY || undefined),
    warnings: configWarnings(env, listen),
  }
}
