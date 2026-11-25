import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
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

it('npm run dev takes changes from the addresses it is opened at, and from no other', { timeout: 60_000 }, async () => {
  const dev = startServerProcess(
    ['--import', 'tsx', 'scripts/dev.ts', '--data-dir', 'memory://'],
    { PORT: String(await findFreePort()) },
    true,
  )
  onTestFinished(async () => {
    await dev.stop()
  })
  const url = new URL(await dev.ready)
  const post = async (route: string, origin: string) => {
    const response = await fetch(`${url.href}api/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: 'a@client.example', password: 'wrong', account: 'admin' }),
    })
    return [response.status, ((await response.json()) as { error: { code: string } }).error.code]
  }
  expect(await post('session/sign-in', url.origin)).toEqual([401, 'invalid_credentials'])
  expect(await localhostPost(url)).toBe(401)
  expect(await post('session/sign-in', 'https://evil.example')).toEqual([403, 'csrf'])
  expect(await post('session/demo', url.origin)).toEqual([404, 'not_found'])
})

/** Signs in as a page opened at http://localhost would. */
function localhostPost({ hostname, port }: URL): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const host = `localhost:${port}`
    const headers = { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json' }
    request({ hostname, port, path: '/api/session/sign-in', method: 'POST', headers }, (response) => {
      response.resume()
      resolve(response.statusCode)
    })
      .on('error', reject)
      .end(JSON.stringify({ email: 'a@client.example', password: 'wrong' }))
  })
}
