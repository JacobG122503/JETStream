import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ServerConfig } from './config'
import * as databases from './db/database'
import { applyMigrations } from './db/migrations'
import { people } from './db/schema'
import { prepareData, startServer } from './server'
import { makeRecords } from './testing/records'
import { findFreePort } from './testing/serverProcess'

// Stands in for a real PostgreSQL server, which tests do not have: production start decides by
// mode, so it must not migrate whichever database it opened.
let database: databases.Database
beforeEach(async () => {
  database = await databases.openDatabase({ kind: 'embedded', dataDir: 'memory://' })
  vi.spyOn(databases, 'openDatabase').mockResolvedValue(database)
})
afterEach(() => database.close().catch(() => undefined))

it('refuses to start in production with pending migrations, and does not apply them', async () => {
  const close = vi.spyOn(database, 'close').mockResolvedValue()
  const runMigrations = vi.spyOn(database, 'runMigrations')
  const config: ServerConfig = {
    mode: 'production',
    host: '127.0.0.1',
    port: await findFreePort(),
    basePath: '/',
    database: { kind: 'postgres', url: 'postgres://unused' },
    publicUrl: 'https://time.example.com/',
    trustProxy: 0,
    warnings: [],
  }
  await expect(startServer(config)).rejects.toThrow('npm run db:migrate')
  expect(runMigrations).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
  close.mockRestore()
})

it('seeds the demo once, says how to use it, and never erases', { timeout: 30_000 }, async () => {
  await applyMigrations(database)
  const first = (await prepareData({ mode: 'demo' }, database)).join('\n')
  for (const text of ['Demo data made for 20', 'admin@jet.demo', 'lead@jet.demo', 'employee@jet.demo', 'npm run demo:reset']) {
    expect(first).toContain(text)
  }
  await makeRecords(database.db).person()
  expect((await prepareData({ mode: 'demo' }, database)).join('\n')).toBe(first)
  expect(await database.db.select().from(people)).toHaveLength(12)
})

it('does not seed development or production', async () => {
  await applyMigrations(database)
  expect((await prepareData({ mode: 'development' }, database)).join()).toContain('npm run db:seed')
  expect((await prepareData({ mode: 'production' }, database)).join()).toContain('npm run admin:create')
  expect(await database.db.select().from(people)).toEqual([])
  await makeRecords(database.db).person()
  expect(await prepareData({ mode: 'development' }, database)).toEqual([])
  expect(await prepareData({ mode: 'demo' }, database)).toEqual([])
})
