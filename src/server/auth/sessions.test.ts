import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '../../shared/api'
import type { Database } from '../db'
import { people, roles, sessions } from '../db/schema'
import { accounts, browser, goodPassword, signedIn, testApp, testClock } from '../testing/apiClient'
import { createTestDatabase } from '../testing/testDatabase'
import { cleanUp, startCleaning } from './cleanUp'
import { hashToken } from './tokens'

let database: Database
let account: ReturnType<typeof accounts>
beforeAll(async () => {
  database = await createTestDatabase()
  account = accounts(database.db)
})
afterAll(() => database.close())

const errorCode = (response: { body: unknown }) => (response.body as { error?: { code: string } }).error?.code
const stored = (personId: number) => database.db.select().from(sessions).where(eq(sessions.personId, personId))
const tokenOf = (cookie: string | undefined) => cookie?.split('=')[1] ?? ''

describe('the session cookie', () => {
  it('is HttpOnly, SameSite=Lax and for the base path, and Secure when the address is https', async () => {
    const person = await account()
    const plain = await signedIn(testApp({ db: database.db }), person.email)
    expect(plain.setCookie).toMatch(/^jetstream_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax$/)
    const app = testApp({ db: database.db, basePath: '/jetstream/', publicUrl: 'https://time.example.com/jetstream/' })
    const secure = await signedIn(app, person.email, goodPassword, '/jetstream')
    expect(secure.setCookie).toMatch(/^jetstream_session=[\w-]{43}; Path=\/jetstream\/; HttpOnly; Secure; SameSite=Lax$/)
  })

  it('lasts longer than the browser only with "Keep me signed in"', async () => {
    const person = await account()
    const client = browser(testApp({ db: database.db, now: testClock().now }))
    await client.signIn(person.email, goodPassword, true)
    expect(client.setCookie).toContain(`Max-Age=${90 * 24 * 3600};`)
    expect(client.setCookie).toContain('HttpOnly')
  })

  it('is new at each sign-in and stored as a hash only', async () => {
    const person = await account()
    const app = testApp({ db: database.db })
    const [a, b] = [await signedIn(app, person.email), await signedIn(app, person.email)]
    expect(a.cookie).not.toBe(b.cookie)
    const rows = await stored(person.id)
    expect(rows.map((row) => row.tokenHash).sort()).toEqual([a, b].map(({ cookie }) => hashToken(tokenOf(cookie))).sort())
    expect(JSON.stringify(rows)).not.toContain(tokenOf(a.cookie))
    expect((await a.get('/session')).text).not.toContain(tokenOf(a.cookie))
  })

  it('belongs to one session: signing in again in the same browser ends the one before', async () => {
    const person = await account()
    const client = await signedIn(testApp({ db: database.db }), person.email)
    await client.signIn(person.email, goodPassword)
    expect(await stored(person.id)).toHaveLength(1)
  })
})

describe('how long a session lasts', () => {
  async function start(keep: boolean) {
    const clock = testClock()
    const person = await account()
    const client = browser(testApp({ db: database.db, now: clock.now }))
    await client.signIn(person.email, goodPassword, keep)
    const alive = async () => (await client.get('/account')).status === 200
    return { clock, alive, person }
  }
  const hour = 60
  const day = 24 * hour

  it.each([
    ['without', false, 12 * hour],
    ['with', true, 30 * day],
  ])('%s "Keep me signed in" it ends when not used', async (_name, keep, idle) => {
    const { clock, alive, person } = await start(keep)
    clock.forward(idle - 1)
    expect(await alive()).toBe(true)
    clock.forward(idle - 1)
    expect(await alive()).toBe(true)
    clock.forward(idle + 1)
    expect(await alive()).toBe(false)
    expect(await stored(person.id)).toEqual([])
  })

  it('ends after 24 hours, also when used each hour', async () => {
    const { clock, alive } = await start(false)
    for (let i = 0; i < 23; i++) {
      clock.forward(hour)
      expect(await alive()).toBe(true)
    }
    clock.forward(hour - 1)
    expect(await alive()).toBe(true)
    clock.forward(2)
    expect(await alive()).toBe(false)
  })

  it('ends after 90 days with "Keep me signed in", also when used each day', async () => {
    const { clock, alive } = await start(true)
    for (let i = 0; i < 89; i++) {
      clock.forward(day)
      expect(await alive()).toBe(true)
    }
    clock.forward(day + 1)
    expect(await alive()).toBe(false)
  })

  it('writes the last use at most once a minute', async () => {
    const { clock, alive, person } = await start(false)
    const lastUse = async () => (await stored(person.id))[0]?.lastUsedAt.toISOString()
    clock.forward(0.9)
    await alive()
    expect(await lastUse()).toBe('2026-03-02T15:00:00.000Z')
    clock.forward(0.2)
    await alive()
    expect(await lastUse()).toBe('2026-03-02T15:01:06.000Z')
  })
})

describe('who the person is now', () => {
  it('is judged anew on every request', async () => {
    const person = await account('administrator')
    const client = await signedIn(testApp({ db: database.db }), person.email)
    const set = (values: Partial<typeof people.$inferInsert>) => database.db.update(people).set(values).where(eq(people.id, person.id))
    expect((await client.get('/people')).status).toBe(200)
    const [member] = await database.db.select().from(roles).where(eq(roles.key, 'member'))
    await set({ roleId: member?.id })
    expect(errorCode(await client.get('/people'))).toBe('forbidden')
    expect((await client.get('/account')).status).toBe(200)
    await set({ status: 'pending' })
    expect(errorCode(await client.get('/account'))).toBe('pending_approval')
    await set({ status: 'archived' })
    const refused = await client.get('/account')
    expect([refused.status, errorCode(refused)]).toEqual([401, 'unauthenticated'])
    expect(await stored(person.id)).toEqual([])
    await set({ status: 'active' })
    expect((await client.get('/account')).status).toBe(401)
  })
})

describe('signing out', () => {
  it('ends the session on the server and clears the cookie', async () => {
    const person = await account()
    const client = await signedIn(testApp({ db: database.db }), person.email)
    const { cookie } = client
    const response = await client.post('/session/sign-out')
    expect(response.status).toBe(200)
    expect((response.body as SessionInfo).person).toBeNull()
    expect(client.setCookie).toMatch(/^jetstream_session=; Path=\/; Expires=Thu, 01 Jan 1970/)
    client.cookie = cookie
    expect((await client.get('/account')).status).toBe(401)
    // Also without a session, so that a page that is behind can always sign out.
    expect((await client.post('/session/sign-out')).status).toBe(200)
  })
})

describe('the session status', () => {
  it('answers 200 signed in or not', async () => {
    const app = testApp({ db: database.db })
    const person = await account('manager', { name: 'Sam Rivera' })
    const anonymous = await browser(app).get('/session')
    expect(anonymous.status).toBe(200)
    expect(anonymous.headers['cache-control']).toBe('no-store')
    expect(anonymous.body).toMatchObject({ person: null, csrfToken: null, demoAccounts: [], company: { timeZone: 'America/Chicago' } })
    const client = await signedIn(app, person.email)
    expect((await client.get('/session')).body).toMatchObject({
      person: { name: 'Sam Rivera', role: { name: 'Manager' }, administrator: false, status: 'active', timeZone: 'America/Chicago' },
    })
    const stale = browser(app)
    stale.cookie = `jetstream_session=${'x'.repeat(43)}`
    expect((await stale.get('/session')).body).toMatchObject({ person: null })
    // A cookie of a session that is gone must not keep anyone from signing in.
    expect((await stale.signIn(person.email, goodPassword)).status).toBe(200)
  })
})

describe('cleaning up', () => {
  it('removes sessions that ended, and stops at once', async () => {
    const person = await account()
    const clock = testClock()
    const app = testApp({ db: database.db, now: clock.now })
    const short = browser(app)
    await short.signIn(person.email, goodPassword)
    const long = browser(app)
    await long.signIn(person.email, goodPassword, true)
    clock.forward(11 * 60)
    await cleanUp({ db: database.db, now: clock.now })
    expect(await stored(person.id)).toHaveLength(2)
    clock.forward(2 * 60)
    const stop = await startCleaning({ db: database.db, now: clock.now })
    expect((await stored(person.id)).map(({ persistent }) => persistent)).toEqual([true])
    await stop()
  })

  it('repeats at least hourly and survives an error', async () => {
    vi.useFakeTimers()
    try {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const broken = { delete: vi.fn(() => { throw new Error('secret text') }) }
      const stop = await startCleaning({ db: broken as never, now: () => new Date() })
      expect(broken.delete).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(broken.delete.mock.calls.length).toBeGreaterThanOrEqual(2)
      const calls = broken.delete.mock.calls.length
      await stop()
      await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)
      expect(broken.delete).toHaveBeenCalledTimes(calls)
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret text')
    } finally {
      vi.useRealTimers()
    }
  })
})
