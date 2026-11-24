// Runs the commands as processes, from source.
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from './db'
import { applyMigrations } from './db/migrations'
import { people } from './db/schema'
import { demoSeedDate } from './demo'
import { findFreePort, type ServerProcess, startServerProcess } from './testing/serverProcess'
import { makeRecords } from './testing/records'
import { createTempDir } from './testing/testDatabase'

const processes: ServerProcess[] = []
afterEach(async () => {
  for (const { child, exited } of processes.splice(0)) {
    child.kill('SIGKILL')
    await exited
  }
})

function start(args: string[], settings: Record<string, string> = {}) {
  const process = startServerProcess(args, settings)
  processes.push(process)
  return process
}

async function run(args: string[], settings: Record<string, string> = {}) {
  const command = start(['scripts/demo-data.mjs', ...args], settings)
  command.child.stdin?.end()
  return { code: await command.exited, output: command.output() }
}

async function inDatabase<T>(dataDir: string, work: (database: Awaited<ReturnType<typeof openDatabase>>) => Promise<T>) {
  const database = await openDatabase({ kind: 'embedded', dataDir })
  try {
    return await work(database)
  } finally {
    await database.close()
  }
}
const peopleIn = (dataDir: string) => inDatabase(dataDir, async ({ db }) => (await db.select().from(people)).length)

describe('demo-data commands', { timeout: 60_000 }, () => {
  it('seed an empty database, refuse a used one, and reset', async () => {
    const dataDir = join(await createTempDir(), 'db')
    const folder = ['--data-dir', dataDir]
    const seeded = await run(['seed', ...folder, '--today=2026-11-23'])
    expect(seeded).toMatchObject({ code: 0 })
    for (const text of ['2026-11-23', 'admin@jet.demo', 'lead@jet.demo', 'employee@jet.demo']) expect(seeded.output).toContain(text)
    expect(await peopleIn(dataDir)).toBe(11)

    const again = await run(['seed', ...folder])
    expect(again.code).toBe(1)
    expect(again.output).toContain('already holds people')

    const unconfirmed = await run(['reset', ...folder])
    expect(unconfirmed.code).toBe(1)
    expect(unconfirmed.output).toContain('--yes')
    expect(await inDatabase(dataDir, ({ db }) => demoSeedDate(db))).toBe('2026-11-23')

    const reset = await run(['reset', ...folder, '--yes', '--today=2026-12-31'])
    expect(reset).toMatchObject({ code: 0 })
    expect(await inDatabase(dataDir, ({ db }) => demoSeedDate(db))).toBe('2026-12-31')
  })

  it('reset refuses records that are not demo data, whatever is allowed', async () => {
    const dataDir = join(await createTempDir(), 'db')
    await inDatabase(dataDir, async (database) => {
      await applyMigrations(database)
      await makeRecords(database.db).person()
    })
    for (const action of ['seed', 'reset']) {
      const refused = await run([action, '--data-dir', dataDir, '--yes'], { ALLOW_DEMO_DATA: 'true', NODE_ENV: 'production' })
      expect(refused.code).toBe(1)
      expect(refused.output).toMatch(/holds people|not demo data/)
    }
    expect(await peopleIn(dataDir)).toBe(1)
  })

  it('refuse production without connecting', async () => {
    let connections = 0
    const server = createServer((socket) => {
      connections++
      socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = address !== null && typeof address === 'object' ? address.port : 0
    const url = `postgres://u:hunter2@127.0.0.1:${port}/x`
    try {
      const refusals: Record<string, string>[] = [
        { NODE_ENV: 'production' },
        { DATABASE_URL: url },
        { NODE_ENV: 'production', ALLOW_DEMO_DATA: 'yes' },
        { DATABASE_URL: url, ALLOW_DEMO_DATA: '1' },
      ]
      for (const settings of refusals) {
        for (const args of [['seed'], ['reset', '--yes'], ['reset', '--demo', '--yes']]) {
          const refused = await run(args, settings)
          expect(refused.code).toBe(1)
          expect(refused.output).toContain('ALLOW_DEMO_DATA=true')
          expect(refused.output).not.toContain('hunter2')
        }
      }
      expect(connections).toBe(0)
      const allowed = await run(['seed'], { DATABASE_URL: url, ALLOW_DEMO_DATA: 'true' })
      expect(allowed.code).toBe(1)
      expect(allowed.output).toContain('Cannot connect')
      expect(allowed.output).not.toContain('hunter2')
      expect(connections).toBeGreaterThan(0)
    } finally {
      server.close()
    }
  })

  it('refuse a database in use by the app, which keeps working', async () => {
    const dataDir = join(await createTempDir(), 'db')
    const port = String(await findFreePort())
    const app = start(['--import', 'tsx', 'src/server/main.ts', '--dev', '--data-dir', dataDir], { PORT: port })
    await expect.poll(() => app.output(), { timeout: 20_000 }).toContain('API ready')
    // Development never adds demo data, and says how to.
    expect(app.output()).toContain('npm run db:seed')
    for (const action of ['seed', 'reset']) {
      const refused = await run([action, '--data-dir', dataDir, '--yes'])
      expect(refused.code).toBe(1)
      expect(refused.output).toContain('Stop it first')
    }
    const health = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(await health.json()).toEqual({ status: 'ok', database: 'ok' })

    // Killed without closing: its lock stays behind, and does not block the command.
    await app.stop('SIGKILL')
    expect(existsSync(`${dataDir}.lock`)).toBe(true)
    expect(await run(['reset', '--data-dir', dataDir, '--yes'])).toMatchObject({ code: 0 })
    expect(await peopleIn(dataDir)).toBe(11)
  })

  it('work after a lock left by a process that is gone', async () => {
    const dataDir = join(await createTempDir(), 'db')
    await writeFile(`${dataDir}.lock`, '99999999')
    expect(await run(['seed', '--data-dir', dataDir])).toMatchObject({ code: 0 })
  })
})
