import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ServerConfig } from './config'
import * as databases from './db/database'
import { startServer } from './server'
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
  }
  await expect(startServer(config)).rejects.toThrow('npm run db:migrate')
  expect(runMigrations).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
  close.mockRestore()
})
