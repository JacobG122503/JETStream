// Runs the server as a process, from source: `npm test` works without a build.
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from './db/database'
import { applyMigrations } from './db/migrations'
import { appMeta } from './db/schema'
import { findFreePort, type ServerProcess, startServerProcess } from './testing/serverProcess'
import { createTempDir } from './testing/testDatabase'

const processes: ServerProcess[] = []
afterEach(async () => {
  for (const { child, exited } of processes.splice(0)) {
    child.kill('SIGKILL')
    await exited
  }
})

function start(args: string[], settings: Record<string, string> = {}) {
  const server = startServerProcess(['--import', 'tsx', 'src/server/main.ts', ...args], settings)
  processes.push(server)
  return server
}

async function expectFailure(
  args: string[],
  settings: Record<string, string>,
  message: string,
  limitMs = 5000,
) {
  const begin = Date.now()
  const server = start(args, settings)
  expect(await server.exited).toBe(1)
  expect(Date.now() - begin).toBeLessThan(limitMs)
  expect(server.output()).toContain(message)
  expect(server.output()).not.toContain('hunter2')
  return server.output()
}

async function listenOn(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No port')
  return address.port
}

const unreachable = 'postgres://u:hunter2@127.0.0.1:1/x'

describe('server process', { timeout: 30_000 }, () => {
  it.each([
    ['production without DATABASE_URL', [], { NODE_ENV: 'production' }, 'DATABASE_URL'],
    ['demo with DATABASE_URL', ['--demo'], { DATABASE_URL: unreachable }, 'DATABASE_URL'],
    ['PORT=abc', ['--demo'], { PORT: 'abc' }, 'PORT'],
    ['PORT=70000', ['--demo'], { PORT: '70000' }, 'PORT'],
    ['BASE_PATH=jet', ['--demo'], { BASE_PATH: 'jet' }, 'BASE_PATH'],
    ['an unreadable DATABASE_URL', [], { DATABASE_URL: 'postgres://u:hunter2/@:x:/y' }, 'DATABASE_URL'],
  ])('refuses to start: %s', async (_name, args, settings, message) => {
    await expectFailure(args, settings, message)
  })

  it('refuses to start when the database cannot be reached', async () => {
    const port = String(await findFreePort())
    const output = await expectFailure([], { DATABASE_URL: unreachable, PORT: port }, 'Cannot connect', 15_000)
    expect(output).toContain('ECONNREFUSED')
  })

  it('refuses to start when the database accepts the connection but never answers', async () => {
    const sockets: Socket[] = []
    const silent = createServer((socket) => sockets.push(socket))
    const databasePort = await listenOn(silent)
    try {
      const settings = {
        DATABASE_URL: `postgres://u:hunter2@127.0.0.1:${databasePort}/x`,
        PORT: String(await findFreePort()),
      }
      await expectFailure([], settings, 'Cannot connect', 15_000)
    } finally {
      sockets.forEach((socket) => socket.destroy())
      silent.close()
    }
  })

  it('refuses to start when the port is in use', async () => {
    const other = createServer()
    const port = String(await listenOn(other))
    try {
      await expectFailure(['--demo', '--data-dir', 'memory://'], { PORT: port }, port)
    } finally {
      other.close()
    }
  })

  it.each(['SIGINT', 'SIGTERM'] as const)('stops on %s and keeps its data', async (signal) => {
    const dataDir = join(await createTempDir(), 'db')
    const before = await openDatabase({ kind: 'embedded', dataDir })
    await applyMigrations(before)
    await before.db.insert(appMeta).values({ key: 'a', value: 'kept' })
    await before.close()

    const server = start(['--dev', '--data-dir', dataDir], { PORT: String(await findFreePort()) })
    await expect.poll(() => server.output(), { timeout: 15_000 }).toContain('API ready')
    const begin = Date.now()
    expect(await server.stop(signal)).toBe(0)
    expect(Date.now() - begin).toBeLessThan(5000)

    const after = await openDatabase({ kind: 'embedded', dataDir })
    expect(await after.db.select().from(appMeta)).toEqual([{ key: 'a', value: 'kept' }])
    await after.close()
  })

  it('serves the API only, with no X-Powered-By, in development', async () => {
    const port = await findFreePort()
    const server = start(['--dev', '--data-dir', 'memory://'], { PORT: String(port) })
    await expect.poll(() => server.output(), { timeout: 15_000 }).toContain('API ready')
    const health = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(await health.json()).toEqual({ status: 'ok', database: 'ok' })
    expect(health.headers.has('x-powered-by')).toBe(false)
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404)
  })
})
