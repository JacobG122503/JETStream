// What happens to a sign-in, or a password change, that is under way while the password changes or
// the person is archived. The hash computation is held, which is where nearly all of the time goes.
// The embedded database has one connection, so the transactions themselves run in turn here.
import { scrypt } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createContext } from '../app'
import type { Database } from '../db'
import { invites, people, personCredentials, sessions, signInAttempts } from '../db/schema'
import { captureSender } from '../email/sender'
import { resetAdministrator } from '../people/firstAdministrator'
import { storePassword } from '../people/resets'
import { hashPassword } from '../security/passwords'
import { accounts, browser, goodPassword, signedIn, testApp } from '../testing/apiClient'
import { hashOld } from '../testing/oldHash'
import { createTestDatabase } from '../testing/testDatabase'
import { beginSession } from './signIn'

vi.mock('node:crypto', async (original) => {
  const crypto = await original<typeof import('node:crypto')>()
  return { ...crypto, scrypt: vi.fn(crypto.scrypt) }
})
const { scrypt: realScrypt } = await vi.importActual<typeof import('node:crypto')>('node:crypto')

const newPassword = 'a new good phrase'

/** Holds the hash computation that begins as the n-th from now. */
function holdHash(n = 1) {
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => (release = resolve))
  let begin: () => void = () => undefined
  const begun = new Promise<void>((resolve) => (begin = resolve))
  let count = 0
  vi.mocked(scrypt).mockImplementation(((...args: unknown[]) => {
    const compute = () => Reflect.apply(realScrypt, undefined, args) as void
    if (++count !== n) return compute()
    begin()
    void released.then(compute)
  }) as typeof scrypt)
  return { begun, release }
}

let database: Database
let account: ReturnType<typeof accounts>
let app: ReturnType<typeof testApp>
beforeAll(async () => {
  database = await createTestDatabase()
  account = accounts(database.db)
  app = testApp({ db: database.db })
})
afterAll(() => database.close())
beforeEach(async () => {
  await database.db.delete(signInAttempts)
})
afterEach(() => void vi.mocked(scrypt).mockImplementation(realScrypt))

const sessionsOf = async (personId: number) =>
  (await database.db.select().from(sessions).where(eq(sessions.personId, personId))).length
const credential = async (personId: number) =>
  (await database.db.select().from(personCredentials).where(eq(personCredentials.personId, personId)))[0]
const canSignIn = async (email: string, password: string) => (await browser(app).signIn(email, password)).status === 200
const setHash = (personId: number, passwordHash: string) =>
  database.db.update(personCredentials).set({ passwordHash }).where(eq(personCredentials.personId, personId))

async function setUp(role: 'administrator' | 'member' = 'member') {
  const person = await account(role)
  const victim = await signedIn(app, person.email)
  return { person, victim }
}
type SetUp = Awaited<ReturnType<typeof setUp>>

const changes: [string, 'administrator' | 'member', (at: SetUp) => Promise<unknown>, number][] = [
  ['the person changes the password', 'member', async ({ victim }) => {
    expect((await victim.post('/account/password', { currentPassword: goodPassword, newPassword })).status).toBe(200)
  }, 1],
  ['a reset link is used', 'member', async ({ person }) => {
    const administrator = await account('administrator')
    const boss = await signedIn(app, administrator.email)
    const { link } = (await boss.post(`/people/${person.id}/reset-link`)).body as { link: string }
    const used = await browser(app).post('/reset-password/use', { token: link.split('#')[1], password: newPassword })
    expect(used.status).toBe(200)
  }, 0],
  ['admin:create --reset sets a password', 'administrator', ({ person }) =>
    resetAdministrator(database.db, captureSender(database.db), person.email, newPassword), 0],
  ['the person is archived', 'member', ({ person }) =>
    database.db.update(people).set({ status: 'archived' }).where(eq(people.id, person.id)), 0],
]

describe.each(changes)('%s', (what, role, change, left) => {
  const archives = what.includes('archived')

  it('ends a sign-in with the old password', async () => {
    const at = await setUp(role)
    const intruder = browser(app)
    const held = holdHash()
    const signIn = intruder.signIn(at.person.email, goodPassword, true)
    await held.begun
    await change(at)
    held.release()
    const answer = await signIn
    expect([answer.status, (answer.body as { error: { code: string } }).error.code]).toEqual([401, 'invalid_credentials'])
    expect(intruder.cookie).toBeUndefined()
    // An archived person's older sessions are removed when used.
    await at.victim.get('/account')
    expect(await sessionsOf(at.person.id)).toBe(left)
    if (archives) return
    expect(await canSignIn(at.person.email, goodPassword)).toBe(false)
    expect(await canSignIn(at.person.email, newPassword)).toBe(true)
  })

  it('is not undone by a sign-in that renews the old hash', async () => {
    const at = await setUp(role)
    const old = await hashOld(goodPassword)
    await setHash(at.person.id, old)
    // The first computation checks the old hash, the second makes the new one.
    const held = holdHash(2)
    const signIn = browser(app).signIn(at.person.email, goodPassword, true)
    await held.begun
    await change(at)
    const after = await credential(at.person.id)
    held.release()
    expect((await signIn).status).toBe(401)
    const last = await credential(at.person.id)
    // Archiving leaves the password alone, so there the same one may get its newer hash.
    if (!archives) expect(last).toEqual(after)
    expect(last?.version).toBe(after?.version)
    await at.victim.get('/account')
    expect(await sessionsOf(at.person.id)).toBe(left)
  })

  // While the current password is checked, and while the new one is hashed. Checks of one person
  // run in turn, so the person's own change would wait for the first.
  it.each(left > 0 ? [2] : [1, 2])('is not undone by a password change from another session (%i)', async (n) => {
    const at = await setUp(role)
    const intruder = await signedIn(app, at.person.email)
    const held = holdHash(n)
    const late = intruder.post('/account/password', { currentPassword: goodPassword, newPassword: 'chosen by the intruder' })
    await held.begun
    await change(at)
    held.release()
    expect((await late).status).toBe(401)
    if (archives) await database.db.update(people).set({ status: 'active' }).where(eq(people.id, at.person.id))
    expect(await canSignIn(at.person.email, 'chosen by the intruder')).toBe(false)
    expect(await canSignIn(at.person.email, archives ? goodPassword : newPassword)).toBe(true)
  })
})

it('signing out elsewhere ends a password change from there', async () => {
  const { person, victim } = await setUp()
  const intruder = await signedIn(app, person.email)
  const held = holdHash()
  const under = intruder.post('/account/password', { currentPassword: goodPassword, newPassword: 'chosen by the intruder' })
  await held.begun
  expect((await victim.post('/account/sessions/end-others')).status).toBe(200)
  held.release()
  expect((await under).status).toBe(401)
  expect(await canSignIn(person.email, goodPassword)).toBe(true)
})

it('a newer password stays when an older one was checked, also in the same session', async () => {
  const { person, victim } = await setUp()
  const held = holdHash()
  const under = victim.post('/account/password', { currentPassword: goodPassword, newPassword: 'the late password' })
  await held.begun
  const hash = await hashPassword(newPassword)
  await database.db.transaction((tx) => storePassword(tx, person.id, hash, new Date()))
  held.release()
  expect((await under).status).toBe(409)
  expect((await credential(person.id))?.passwordHash).toBe(hash)
})

it('a renewed hash is the same password: it ends neither a sign-in nor a change', async () => {
  const { person, victim } = await setUp()
  await setHash(person.id, await hashOld(goodPassword))
  const version = (await credential(person.id))?.version
  const held = holdHash()
  const change = victim.post('/account/password', { currentPassword: goodPassword, newPassword })
  await held.begun
  expect(await canSignIn(person.email, goodPassword)).toBe(true)
  expect((await credential(person.id))?.passwordHash).toContain('ln=15')
  expect((await credential(person.id))?.version).toBe(version)
  held.release()
  expect((await change).status).toBe(200)

  await setHash(person.id, await hashOld(newPassword))
  const second = holdHash()
  const signIn = browser(app).signIn(person.email, newPassword)
  await second.begun
  // From another address, which does not wait for the first.
  const elsewhere = await browser(testApp({ db: database.db, trustProxy: 1 })).send(
    'post', '/session/sign-in', { email: person.email, password: newPassword }, { 'X-Forwarded-For': '192.0.2.7' },
  )
  expect(elsewhere.status).toBe(200)
  second.release()
  expect((await signIn).status).toBe(200)
})

it('a declined person does not get in', async () => {
  const person = await account('member', { status: 'pending' })
  const boss = await signedIn(app, (await account('administrator')).email)
  const held = holdHash()
  const signIn = browser(app).signIn(person.email, goodPassword)
  await held.begun
  expect((await boss.post(`/requests/${person.id}/decline`)).status).toBe(200)
  held.release()
  expect((await signIn).status).toBe(401)
})

it('an invite does not let in someone archived while the password is hashed', async () => {
  const boss = await signedIn(app, (await account('administrator')).email)
  const person = await account()
  await database.db.delete(personCredentials).where(eq(personCredentials.personId, person.id))
  const [{ id: roleId } = { id: 0 }] = ((await boss.get('/people/options')).body as { roles: { id: number }[] }).roles.slice(-1)
  const made = await boss.post('/invites', { name: 'Ada', email: person.email, roleId })
  const held = holdHash()
  const accepting = browser(app).post('/invite/accept', {
    token: (made.body as { link: string }).link.split('#')[1], name: 'Ada', password: newPassword, timeZone: 'UTC',
  })
  await held.begun
  await database.db.update(people).set({ status: 'archived' }).where(eq(people.id, person.id))
  held.release()
  expect((await accepting).status).toBe(410)
  expect(await sessionsOf(person.id)).toBe(0)
  expect((await database.db.select().from(invites).where(eq(invites.email, person.email)))[0]?.acceptedAt).toBeNull()
})

it('a demo account that is archived meanwhile does not get in', async () => {
  const ctx = createContext({ db: database.db, basePath: '/', mode: 'demo' })
  const person = await account('member', { status: 'archived' })
  const req = { get: () => undefined, headers: {}, socket: {} } as never
  await expect(beginSession(ctx, req, {} as never, { personId: person.id, passwordVersion: null }, false)).rejects.toMatchObject({ code: 'demo_unavailable' })
  expect(await sessionsOf(person.id)).toBe(0)
})
