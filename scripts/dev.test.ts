import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { findFreePort, startServerProcess } from '../src/server/testing/serverProcess'
import { createTempDir } from '../src/server/testing/testDatabase'

// Windows has no signals to send.
it.skipIf(process.platform === 'win32').each([
  ['Ctrl+C in a terminal', 'SIGINT', true],
  ['a signal to the command alone', 'SIGTERM', false],
] as const)(
  'npm run dev closes the database on %s',
  { timeout: 60_000 },
  async (_name, signal, wholeGroup) => {
    const dataDir = join(await createTempDir(), 'db')
    const lockFile = `${dataDir}.lock`
    const dev = startServerProcess(
      ['--import', 'tsx', 'scripts/dev.ts', '--data-dir', dataDir],
      { PORT: String(await findFreePort()) },
      true,
    )
    const { pid } = dev.child
    if (pid === undefined) throw new Error('Not started')
    onTestFinished(async () => {
      dev.child.kill('SIGTERM')
      await dev.exited
    })

    const url = await dev.ready
    expect(await (await fetch(`${url}api/health`)).json()).toEqual({ status: 'ok', database: 'ok' })
    const apiPid = Number(readFileSync(lockFile, 'utf8'))

    process.kill(wholeGroup ? -pid : pid, signal)
    expect(await dev.exited).toBe(0)
    expect(existsSync(lockFile)).toBe(false) // Removed after the database is closed.
    expect(() => process.kill(apiPid, 0)).toThrow('ESRCH')
    expect(dev.output()).not.toContain('killing')
  },
)

it.skipIf(process.platform === 'win32')(
  'npm run dev leaves nothing running when stopped while starting',
  { timeout: 60_000 },
  async () => {
    const dataDir = join(await createTempDir(), 'db')
    const dev = startServerProcess(
      ['--import', 'tsx', 'scripts/dev.ts', '--data-dir', dataDir],
      { PORT: String(await findFreePort()) },
      true,
    )
    const { pid } = dev.child
    if (pid === undefined) throw new Error('Not started')
    onTestFinished(async () => {
      dev.child.kill('SIGTERM')
      await dev.exited
    })
    await expect.poll(() => existsSync(`${dataDir}.lock`), { timeout: 20_000, interval: 10 }).toBe(true)
    process.kill(-pid, 'SIGINT')
    expect(await dev.exited).toBe(0) // Resolves once every process has closed the output.
    expect(existsSync(`${dataDir}.lock`)).toBe(false)
  },
)
