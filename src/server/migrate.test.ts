import { expect, it } from 'vitest'
import { startServerProcess } from './testing/serverProcess'

it.each([
  ['an unreachable database', { DATABASE_URL: 'postgres://u:hunter2@127.0.0.1:1/x' }, 'Cannot connect'],
  ['no database in production', { NODE_ENV: 'production' }, 'DATABASE_URL'],
])('db:migrate fails for %s', async (_name, settings, message) => {
  const command = startServerProcess(['scripts/db-migrate.mjs'], settings)
  expect(await command.exited).toBe(1)
  expect(command.output()).toContain(message)
  expect(command.output()).not.toContain('hunter2')
}, 20_000)
