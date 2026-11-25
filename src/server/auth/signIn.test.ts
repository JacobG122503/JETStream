import { scrypt } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../db'
import { appMeta, people, personCredentials, roles, sessions, signInAttempts } from '../db/schema'
import { demoAccounts } from '../demo/accounts'
import { markerKey } from '../demo/marker'
import { accounts, browser, goodPassword, signedIn, testApp, testClock } from '../testing/apiClient'
import { makeRecords } from '../testing/records'
import { createTestDatabase } from '../testing/testDatabase'
import { cleanUp } from './cleanUp'
import { limitAddress } from './clientAddress'

// Counts the hash computations there really are.
vi.mock('node:crypto', async (original) => {
  const crypto = await original<typeof import('node:crypto')>()
  return { ...crypto, scrypt: vi.fn(crypto.scrypt) }
})

let database: Database
let account: ReturnType<typeof accounts>
beforeAll(async () => {
  database = await createTestDatabase()
  account = accounts(database.db)
})
afterAll(() => database.close())
beforeEach(async () => {
  await database.db.delete(signInAttempts)
})

const errorCode = (response: { body: unknown }) => (response.body as { error?: { code: string } }).error?.code
const summary = (response: { status: number; body: unknown }) => [response.status, errorCode(response)]
const invalid = [401, 'invalid_credentials']
const limited = [429, 'too_many_attempts']

describe('signing in', () => {
  it('answers every refusal the same, after one full hash computation', async () => {
    const app = testApp({ db: database.db })
    const active = await account()
    const archived = await account('member', { status: 'archived' })
    const without = await makeRecords(database.db).person()
    const attempts: [string, string][] = [
      [active.email, 'wrong password'],
      ['nobody@jet.example', goodPassword],
      [archived.email, goodPassword],
      [without.email, goodPassword],
    ]
    const answers = new Set<string>()
    for (const [email, password] of attempts) {
      vi.mocked(scrypt).mockClear()
      const response = await browser(app).signIn(email, password)
      expect(summary(response)).toEqual(invalid)
      expect(response.get('Set-Cookie')).toBeUndefined()
      answers.add(response.text)
      expect(vi.mocked(scrypt).mock.calls.map(([, , length, options]) => [length, options])).toEqual([
        [32, expect.objectContaining({ N: 2 ** 15, r: 8, p: 3 })],
      ])
    }
    expect(answers.size).toBe(1)
  })

  it('ignores case and surrounding spaces of the email', async () => {
    const person = await account('member', { email: 'New.Person@Example.com' })
    const response = await browser(testApp({ db: database.db })).signIn('  nEW.person@example.COM ', goodPassword)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ person: { id: person.id } })
  })

  it('lets a pending person in to wait', async () => {
    const person = await account('member', { status: 'pending' })
    const client = await signedIn(testApp({ db: database.db }), person.email)
    expect((await client.get('/session')).body).toMatchObject({ person: { status: 'pending' } })
    expect(summary(await client.get('/account'))).toEqual([403, 'pending_approval'])
  })

  it('makes a new hash where the old one has other parameters', async () => {
    const person = await account()
    const app = testApp({ db: database.db })
    const { hashOld } = await import('../testing/oldHash')
    const old = await hashOld(goodPassword)
    const own = eq(personCredentials.personId, person.id)
    await database.db.update(personCredentials).set({ passwordHash: old }).where(own)
    const hash = async () => (await database.db.select().from(personCredentials).where(own))[0]?.passwordHash
    await browser(app).signIn(person.email, 'wrong password')
    expect(await hash()).toBe(old)
    await signedIn(app, person.email)
    expect(await hash()).toMatch(/^\$scrypt\$ln=15,r=8,p=3\$/)
    await signedIn(app, person.email)
  })

  it('refuses what is not an email and a password', async () => {
    const client = browser(testApp({ db: database.db }))
    for (const body of [{}, [], { email: 'a@b.example' }, { email: 1, password: 'x' }, { email: 'a\u0000@b.example', password: 'x' }, { email: 'a@b.example', password: ['x'] }]) {
      expect(summary(await client.post('/session/sign-in', body))).toEqual([400, 'invalid_input'])
    }
  })

  it('does not block the server: 20 at once finish while health answers', { timeout: 30_000 }, async () => {
    const people = await Promise.all(Array.from({ length: 20 }, () => account()))
    const app = testApp({ db: database.db })
    const signIns = people.map(({ email }) => browser(app).signIn(email, goodPassword))
    const begin = Date.now()
    expect((await browser(app).get('/health')).status).toBe(200)
    expect(Date.now() - begin).toBeLessThan(1000)
    expect((await Promise.all(signIns)).map(({ status }) => status)).toEqual(Array(20).fill(200))
  })
})

describe('limits', () => {
  function setUp(options: Partial<Parameters<typeof testApp>[0]> = {}) {
    const clock = testClock()
    const app = testApp({ db: database.db, now: clock.now, trustProxy: 1, ...options })
    const from = (address: string) => {
      const client = browser(app)
      client.headers = { 'X-Forwarded-For': address }
      return client
    }
    return { clock, app, from }
  }

  it('stop the sixth try of an email from an address, also with the right password, for 15 minutes', async () => {
    const { clock, from, app } = setUp()
    const person = await account()
    const inside = from('203.0.113.1')
    await inside.signIn(person.email, goodPassword)
    for (let i = 0; i < 5; i++) {
      const email = i % 2 ? person.email.toUpperCase() : ` ${person.email}`
      expect(summary(await from('203.0.113.1').signIn(email, 'wrong password'))).toEqual(invalid)
      clock.forward(1)
    }
    const refused = await from('203.0.113.1').signIn(person.email, goodPassword)
    expect(summary(refused)).toEqual(limited)
    expect(refused.headers['retry-after']).toBe(String(10 * 60))
    expect(refused.body).toMatchObject({ error: { retryAfterSeconds: 600 } })
    // A session that was there goes on, and so do others.
    expect((await inside.get('/account')).status).toBe(200)
    expect((await from('203.0.113.2').signIn(person.email, goodPassword)).status).toBe(200)
    expect((await from('203.0.113.1').signIn((await account()).email, goodPassword)).status).toBe(200)
    // The database remembers after a restart.
    const restarted = browser(testApp({ db: database.db, now: clock.now, trustProxy: 1 }))
    restarted.headers = { 'X-Forwarded-For': '203.0.113.1' }
    expect(summary(await restarted.signIn(person.email, goodPassword))).toEqual(limited)
    expect(app).toBeDefined()
    clock.forward(9.9)
    expect(summary(await from('203.0.113.1').signIn(person.email, goodPassword))).toEqual(limited)
    clock.forward(0.2)
    expect((await from('203.0.113.1').signIn(person.email, goodPassword)).status).toBe(200)
  })

  it('treat an email without an account alike', async () => {
    const { from } = setUp()
    for (let i = 0; i < 5; i++) expect(summary(await from('203.0.113.1').signIn('ghost@jet.example', 'x'))).toEqual(invalid)
    expect(summary(await from('203.0.113.1').signIn('ghost@jet.example', 'x'))).toEqual(limited)
  })

  it('start afresh for email and address after a success, but not the others', { timeout: 30_000 }, async () => {
    const { from, clock } = setUp()
    const person = await account()
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 4; i++) expect(summary(await from('203.0.113.1').signIn(person.email, 'x'))).toEqual(invalid)
      expect((await from('203.0.113.1').signIn(person.email, goodPassword)).status).toBe(200)
    }
    // 24 failures so far, of 30 per email in an hour.
    for (let i = 0; i < 6; i++) {
      expect(summary(await from(`203.0.113.${10 + i}`).signIn(person.email, 'x'))).toEqual(invalid)
    }
    expect(summary(await from('203.0.113.99').signIn(person.email, goodPassword))).toEqual(limited)
    clock.forward(61)
    expect((await from('203.0.113.99').signIn(person.email, goodPassword)).status).toBe(200)
  })

  it('stop the 51st failure from one address, whatever the email', { timeout: 30_000 }, async () => {
    const { from } = setUp()
    for (let i = 0; i < 50; i++) {
      await database.db.insert(signInAttempts).values({
        kind: 'sign_in', email: `n${i}@jet.example`, address: '203.0.113.1', succeeded: false, attemptedAt: testClock().now(),
      })
    }
    expect(summary(await from('203.0.113.1').signIn((await account()).email, goodPassword))).toEqual(limited)
    expect((await from('203.0.113.2').signIn((await account()).email, goodPassword)).status).toBe(200)
  })

  it('let at most 5 of 20 simultaneous wrong tries reach the password', async () => {
    const { from } = setUp()
    const person = await account()
    vi.mocked(scrypt).mockClear()
    const answers = await Promise.all(Array.from({ length: 20 }, () => from('203.0.113.1').signIn(person.email, 'wrong password')))
    const count = (status: number) => answers.filter((answer) => answer.status === status).length
    expect([count(401), count(429)]).toEqual([5, 15])
    expect(vi.mocked(scrypt)).toHaveBeenCalledTimes(5)
  })

  it('do not punish pressing twice with the right password', async () => {
    const { from } = setUp()
    const person = await account()
    const answers = await Promise.all(Array.from({ length: 8 }, () => from('203.0.113.1').signIn(person.email, goodPassword)))
    expect(answers.map(({ status }) => status)).toEqual(Array(8).fill(200))
  })

  it('cannot be escaped with X-Forwarded-For', async () => {
    const without = setUp({ trustProxy: 0 })
    const person = await account()
    for (let i = 0; i < 5; i++) await without.from(`203.0.113.${i}`).signIn(person.email, 'x')
    expect(summary(await without.from('203.0.113.77').signIn(person.email, goodPassword))).toEqual(limited)
    // Behind one proxy, only what that proxy added counts.
    const behind = setUp()
    for (let i = 0; i < 5; i++) await behind.from(`198.51.100.${i}, 203.0.113.200`).signIn(person.email, 'x')
    expect(summary(await behind.from('198.51.100.77, 203.0.113.200').signIn(person.email, goodPassword))).toEqual(limited)
    expect((await behind.from('203.0.113.200, 198.51.100.1').signIn(person.email, goodPassword)).status).toBe(200)
  })

  it('count an IPv6 address by its /64', async () => {
    const { from } = setUp()
    const person = await account()
    for (let i = 0; i < 5; i++) await from(`2001:db8:1:2::${i + 1}`).signIn(person.email, 'x')
    expect(summary(await from('2001:db8:1:2:ffff:ffff:ffff:ffff').signIn(person.email, goodPassword))).toEqual(limited)
    expect((await from('2001:db8:1:3::1').signIn(person.email, goodPassword)).status).toBe(200)
  })

  it('forget attempts that no longer count', async () => {
    const { from, clock } = setUp()
    await from('203.0.113.1').signIn('ghost@jet.example', 'x')
    clock.forward(59)
    await cleanUp({ db: database.db, now: clock.now })
    expect(await database.db.select().from(signInAttempts)).toHaveLength(1)
    clock.forward(2)
    await cleanUp({ db: database.db, now: clock.now })
    expect(await database.db.select().from(signInAttempts)).toHaveLength(0)
  })
})

it.each([
  ['203.0.113.7', '203.0.113.7'],
  ['::ffff:203.0.113.7', '203.0.113.7'],
  ['::ffff:cb00:7107', '203.0.113.7'],
  ['::1', '0:0:0:0::/64'],
  ['fe80::1%en0', 'fe80:0:0:0::/64'],
  ['2001:DB8:0:1:2:3:4:5', '2001:db8:0:1::/64'],
  ['2001:db8::', '2001:db8:0:0::/64'],
  ['not an address', undefined],
  ['', undefined],
  [undefined, undefined],
])('counts address %s as %s', (value, expected) => {
  expect(limitAddress(value)).toBe(expected)
})

describe('demo sign-in', () => {
  const signIn = (mode: 'production' | 'development' | 'demo', key: string) =>
    browser(testApp({ db: database.db, mode })).post('/session/demo', { account: key })

  beforeAll(async () => {
    const keys = ['administrator', 'manager', 'member'] as const
    for (const [index, { email }] of demoAccounts.entries()) {
      const [role] = await database.db.select().from(roles).where(eq(roles.key, keys[index] ?? 'member'))
      await makeRecords(database.db).person({ email, roleId: role?.id, name: `Demo ${index}` })
    }
  })

  it('exists in demo mode only, whatever the database and the environment say', async () => {
    vi.stubEnv('ALLOW_DEMO_DATA', 'true')
    await database.db.insert(appMeta).values({ key: markerKey, value: '2026-03-02' })
    for (const mode of ['production', 'development'] as const) {
      expect(summary(await signIn(mode, 'admin'))).toEqual([404, 'not_found'])
      expect((await browser(testApp({ db: database.db, mode })).get('/session')).body).toMatchObject({ demoAccounts: [] })
    }
    vi.unstubAllEnvs()
    const { body } = (await browser(testApp({ db: database.db, mode: 'demo' })).get('/session')) as { body: { demoAccounts: object[] } }
    expect(body.demoAccounts).toMatchObject([
      { key: 'admin', label: 'Administrator', name: 'Demo 0' },
      { key: 'lead', label: 'Project lead', name: 'Demo 1' },
      { key: 'employee', label: 'Employee', name: 'Demo 2' },
    ])
    for (const { key, email } of demoAccounts) {
      const response = await signIn('demo', key)
      expect([response.status, (response.body as { person: { email: string } }).person.email]).toEqual([200, email])
    }
  })

  it('needs the demo marker and an active account, and knows three accounts only', async () => {
    for (const key of ['other', 'admin@jet.demo', '', '__proto__']) expect((await signIn('demo', key)).status).toBe(400)
    const lead = eq(people.email, 'lead@jet.demo')
    await database.db.update(people).set({ status: 'archived' }).where(lead)
    expect(summary(await signIn('demo', 'lead'))).toEqual([403, 'demo_unavailable'])
    await database.db.delete(appMeta).where(eq(appMeta.key, markerKey))
    expect(summary(await signIn('demo', 'admin'))).toEqual([403, 'demo_unavailable'])
    const rows = await database.db.select().from(sessions).innerJoin(people, and(eq(people.id, sessions.personId), lead))
    expect(rows.length).toBe(1) // From the test before.
  })
})
