import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { createApp } from './app'
import type { ServerConfig } from './config'
import { type Database, openDatabase } from './db/database'
import { applyMigrations, countPendingMigrations } from './db/migrations'
import { errorCode, StartupError } from './errors'
import { webBuildDir } from './paths'

export interface RunningServer {
  url: string
  /** What whoever started it should know. */
  messages: string[]
  /** Finishes open requests, then closes the database. */
  close: () => Promise<void>
}

const requestGraceMs = 2000

/** It was told to stop before it had started. The database is closed. */
export class StoppedError extends Error {}

export async function startServer(config: ServerConfig, signal?: AbortSignal): Promise<RunningServer> {
  // Looked at before each slow step, so that stopping does not wait for all of them.
  const goOn = () => {
    if (signal?.aborted) throw new StoppedError()
  }
  await checkPortIsFree(config)
  goOn()
  const database = await openDatabase(config.database)
  try {
    goOn()
    await prepareSchema(config, database)
    goOn()
    const messages = await prepareData(config, database)
    const app = createApp({
      db: database.db,
      basePath: config.basePath,
      webDir: config.mode === 'development' ? undefined : webBuildDir,
    })
    const server = createServer(app)
    await listen(server, config)
    return {
      url: serverUrl(config),
      messages,
      close: async () => {
        await closeServer(server)
        await database.close()
      },
    }
  } catch (error) {
    await database.close()
    throw error
  }
}

async function prepareSchema(config: ServerConfig, database: Database) {
  if (config.mode !== 'production') {
    await applyMigrations(database)
    return
  }
  const pending = await countPendingMigrations(database.db)
  if (pending > 0) {
    throw new StartupError(
      `The database is missing ${pending} migration(s). Run npm run db:migrate, then start again.`,
    )
  }
}

/** The demo fills its database when nobody is in it yet. Nothing else ever adds demo data here. */
export async function prepareData({ mode }: Pick<ServerConfig, 'mode'>, { db }: Database): Promise<string[]> {
  if (mode === 'production') return []
  // Loaded on demand: production never loads the demo data.
  const { demoAccountLines, demoSeedDate, holdsPeople, seedDemo } = await import('./demo')
  const empty = !(await holdsPeople(db))
  if (mode === 'development') {
    return empty ? ['The database is empty. For demo data, stop this and run npm run db:seed.'] : []
  }
  const date = empty ? await seedDemo(db) : await demoSeedDate(db)
  if (date === null) return []
  return [
    `Demo data made for ${date}. Accounts:`, ...demoAccountLines(),
    'For fresh data, stop the demo and run npm run demo:reset.',
  ]
}

export function serverUrl({ host, port, basePath }: Pick<ServerConfig, 'host' | 'port' | 'basePath'>) {
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}${basePath}`
}

const portInUse = (port: number) =>
  new StartupError(`Port ${port} is already in use. Stop the other program or set PORT.`)

/**
 * Looks for a listener before the database is opened. Needed besides EADDRINUSE because macOS
 * lets two programs listen on one port when one of them listens on all addresses.
 */
export async function checkPortIsFree({ host, port }: Pick<ServerConfig, 'host' | 'port'>) {
  const target = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host
  const answered = await new Promise<boolean>((resolve) => {
    const socket = connect({ host: target, port, timeout: 1000 })
    const finish = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
  if (answered) throw portInUse(port)
}

async function listen(server: Server, { host, port }: ServerConfig) {
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, resolve)
    })
  } catch (error) {
    const code = errorCode(error)
    if (code === 'EADDRINUSE') throw portInUse(port)
    throw new StartupError(`Cannot listen on HOST ${host}, PORT ${port} (${code ?? 'unknown error'}).`)
  }
}

async function closeServer(server: Server) {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()))
  server.closeIdleConnections()
  const timer = setTimeout(() => server.closeAllConnections(), requestGraceMs)
  await closed
  clearTimeout(timer)
}
