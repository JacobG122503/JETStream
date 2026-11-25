import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Account, SignedInDevice } from '../../shared/api'
import type { Database } from '../db'
import { activityLog, files, outboxMessages, people, sessions, signInAttempts } from '../db/schema'
import { accounts, browser, goodPassword, signedIn, testApp, testClock } from '../testing/apiClient'
import { jpeg, png, withExif } from '../testing/images'
import { createTestDatabase } from '../testing/testDatabase'
import { describeUserAgent } from './userAgent'

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
const fieldsOf = (response: { body: unknown }) => Object.keys((response.body as { error: { fields?: object } }).error.fields ?? {})

async function setUp() {
  const clock = testClock()
  const app = testApp({ db: database.db, now: clock.now })
  const person = await account()
  return { clock, app, person, client: await signedIn(app, person.email) }
}

describe('profile', () => {
  it('can be changed, apart from email and role', async () => {
    const { client, person } = await setUp()
    expect((await client.get('/account')).body).toEqual({
      name: person.name, email: person.email, role: 'Member', timeZone: 'America/Chicago', photoId: null, version: 1,
    })
    const saved = await client.put('/account/profile', {
      name: '  Zoë Example ', timeZone: 'Asia/Kolkata', version: 1, email: 'evil@jet.example', roleId: 1, status: 'archived',
    })
    expect(saved.body).toEqual({
      name: 'Zoë Example', email: person.email, role: 'Member', timeZone: 'Asia/Kolkata', photoId: null, version: 2,
    })
    expect((await client.get('/session')).body).toMatchObject({ person: { name: 'Zoë Example', timeZone: 'Asia/Kolkata' } })
  })

  it('is not changed by a stale edit or a wrong value', async () => {
    const { client, person } = await setUp()
    await client.put('/account/profile', { name: 'Now', timeZone: 'UTC', version: 1 })
    expect(summary(await client.put('/account/profile', { name: 'Late', timeZone: 'UTC', version: 1 }))).toEqual([409, 'stale'])
    for (const [more, field] of [[{ name: '' }, 'name'], [{ name: 'x'.repeat(101) }, 'name'], [{ timeZone: 'Nowhere' }, 'timeZone'], [{ version: undefined }, 'version']] as const) {
      const response = await client.put('/account/profile', Object.assign({ name: 'A', timeZone: 'UTC', version: 2 }, more))
      expect([summary(response), fieldsOf(response)]).toEqual([[400, 'invalid_input'], [field]])
    }
    expect(await database.db.select().from(people).where(eq(people.id, person.id))).toMatchObject([{ name: 'Now', version: 2 }])
  })
})

describe('changing the password', () => {
  const change = (client: Awaited<ReturnType<typeof signedIn>>, currentPassword: string, newPassword: string) =>
    client.post('/account/password', { currentPassword, newPassword })

  it('needs the current one, ends other sessions and renews this one', async () => {
    const { client, app, person } = await setUp()
    const other = await signedIn(app, person.email)
    const before = { cookie: client.cookie, token: client.csrfToken }
    const response = await change(client, goodPassword, 'another password')
    expect(response.status).toBe(200)
    expect(client.cookie).not.toBe(before.cookie)
    expect(client.csrfToken).not.toBe(before.token)
    expect((await client.put('/account/profile', { name: 'Still here', timeZone: 'UTC', version: 1 })).status).toBe(200)
    expect((await other.get('/account')).status).toBe(401)
    const old = browser(app)
    old.cookie = before.cookie
    expect((await old.get('/account')).status).toBe(401)
    expect((await browser(app).signIn(person.email, goodPassword)).status).toBe(401)
    expect((await browser(app).signIn(person.email, 'another password')).status).toBe(200)
    const own = and(eq(activityLog.subjectId, person.id), eq(activityLog.action, 'password_changed'))
    expect(await database.db.select().from(activityLog).where(own)).toMatchObject([{ actorId: person.id }])
    const messages = await database.db.select().from(outboxMessages)
    expect(messages.filter(({ subjectId }) => subjectId === person.id)).toMatchObject([{ kind: 'password_changed' }])
  })

  it('refuses weak passwords, and the wrong current one', async () => {
    const { client, app, person } = await setUp()
    for (const password of ['short', 'aaaaaaaaaaaa', 'jetdemo123', person.email, 'x'.repeat(129)]) {
      const response = await change(client, goodPassword, password)
      expect([summary(response), fieldsOf(response)]).toEqual([[400, 'invalid_input'], ['newPassword']])
    }
    const wrong = await change(client, 'not the password', 'another password')
    expect([summary(wrong), fieldsOf(wrong)]).toEqual([[400, 'invalid_input'], ['currentPassword']])
    expect((await browser(app).signIn(person.email, goodPassword)).status).toBe(200)
  })

  it('is limited to 5 wrong tries in 15 minutes, wherever the person is signed in', async () => {
    const { client, app, person, clock } = await setUp()
    const other = await signedIn(app, person.email)
    for (let i = 0; i < 5; i++) expect((await change(i % 2 ? client : other, 'wrong', 'another password')).status).toBe(400)
    const refused = await change(client, goodPassword, 'another password')
    expect(summary(refused)).toEqual([429, 'too_many_attempts'])
    expect(refused.headers['retry-after']).toBe('900')
    clock.forward(15)
    expect((await change(client, goodPassword, 'another password')).status).toBe(200)
  })

  it('does not undo a password that was set at the same time', async () => {
    const { client, person, app } = await setUp()
    const other = await signedIn(app, person.email)
    const answers = await Promise.all([change(client, goodPassword, 'password of client'), change(other, goodPassword, 'password of other')])
    expect(answers.map(({ status }) => status).sort()).toEqual([200, expect.any(Number) as number])
    expect(answers.filter(({ status }) => status === 200)).toHaveLength(1)
  })
})

describe('where one is signed in', () => {
  const list = (response: { body: unknown }) => (response.body as { sessions: SignedInDevice[] }).sessions
  const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'

  it('shows own sessions only, and ends them', async () => {
    const { client, app, person, clock } = await setUp()
    clock.forward(5)
    const other = browser(app)
    other.headers = { 'User-Agent': firefox }
    await other.signIn(person.email, goodPassword)
    const stranger = await signedIn(app, (await account()).email)
    const devices = list(await client.get('/account/sessions'))
    expect(devices).toHaveLength(2)
    expect(devices.find(({ current }) => !current)).toMatchObject({
      browser: 'Firefox', system: 'Windows', signedInAt: '2026-03-02T15:05:00.000Z', lastUsedAt: '2026-03-02T15:05:00.000Z',
    })
    expect(devices.find(({ current }) => current)?.signedInAt).toBe('2026-03-02T15:00:00.000Z')
    const otherId = devices.find(({ current }) => !current)?.id
    const strangers = list(await stranger.get('/account/sessions'))
    expect((await client.delete(`/account/sessions/${strangers[0]?.id}`)).status).toBe(404)
    expect((await stranger.delete(`/account/sessions/${otherId}`)).status).toBe(404)
    expect((await stranger.get('/account')).status).toBe(200)
    expect(list(await client.delete(`/account/sessions/${otherId}`))).toMatchObject([{ current: true }])
    expect((await other.get('/account')).status).toBe(401)
    expect((await client.delete(`/account/sessions/${otherId}`)).status).toBe(404)
  })

  it('ends all others at once, or this one', async () => {
    const { client, app, person } = await setUp()
    const others = [await signedIn(app, person.email), await signedIn(app, person.email)]
    expect(list(await client.post('/account/sessions/end-others'))).toMatchObject([{ current: true }])
    for (const other of others) expect((await other.get('/account')).status).toBe(401)
    const [{ id } = { id: 0 }] = list(await client.get('/account/sessions'))
    expect((await client.delete(`/account/sessions/${id}`)).status).toBe(200)
    expect(client.cookie).toBeUndefined()
    expect(await database.db.select().from(sessions).where(eq(sessions.personId, person.id))).toEqual([])
  })

  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari', 'macOS'],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0', 'Edge', 'Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', 'Safari', 'iPhone'],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36', 'Chrome', 'Android'],
    ['<script>', 'Unknown browser', 'Unknown system'],
    [null, 'Unknown browser', 'Unknown system'],
  ])('reads %s', (text, name, system) => {
    expect(describeUserAgent(text)).toEqual({ browser: name, system })
  })
})

describe('photo', () => {
  const upload = (client: Awaited<ReturnType<typeof signedIn>>, file: Buffer, type = 'image/png') =>
    client.send('put', '/account/photo', file, { 'Content-Type': type })
  const own = (id: number) => database.db.select().from(files).where(eq(files.ownerId, id))

  it('is stored without metadata, served with its type, replaced and removed', async () => {
    const { client, app, person } = await setUp()
    // What it claims to be does not matter.
    const first = (await upload(client, withExif(jpeg(), 'GPS secret'), 'text/html')).body as Account
    const photo = await client.get(`/photos/${first.photoId}`)
    expect([photo.status, photo.headers['content-type'], photo.headers['x-content-type-options']]).toEqual([200, 'image/jpeg', 'nosniff'])
    expect(photo.headers['cache-control']).toBe('no-store')
    expect((photo.body as Buffer).equals(jpeg())).toBe(true)
    expect((await browser(app).get(`/photos/${first.photoId}`)).status).toBe(401)
    expect((await (await signedIn(app, (await account()).email)).get(`/photos/${first.photoId}`)).status).toBe(200)
    const second = (await upload(client, png(16, 16))).body as Account
    expect(second.photoId).not.toBe(first.photoId)
    expect(await own(person.id)).toMatchObject([{ id: second.photoId, mediaType: 'image/png' }])
    expect((await client.get(`/photos/${first.photoId}`)).status).toBe(404)
    expect((await client.delete('/account/photo')).body).toMatchObject({ photoId: null })
    expect((await client.delete('/account/photo')).status).toBe(200)
    expect(await own(person.id)).toEqual([])
  })

  it('is refused when it is not a picture, damaged or too large, and the old one stays', async () => {
    const { client, person } = await setUp()
    await upload(client, png(16, 16))
    const before = await own(person.id)
    const file = png(64, 64)
    const bad = [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
      Buffer.from('<!doctype html><script>alert(1)</script>'),
      file.subarray(0, file.length - 20),
      png(5000, 10),
      Buffer.from('{"a":1}'),
    ]
    for (const content of bad) expect(summary(await upload(client, content))).toEqual([400, 'bad_image'])
    expect(summary(await client.send('put', '/account/photo'))).toEqual([400, 'bad_image'])
    const big = Buffer.concat([jpeg(), Buffer.alloc(2 * 1024 * 1024)])
    expect(summary(await upload(client, big, 'image/jpeg'))).toEqual([413, 'payload_too_large'])
    expect(await own(person.id)).toEqual(before)
  })

  it('only serves photos, not other files', async () => {
    const { client, person } = await setUp()
    const content = Buffer.from('receipt')
    const [file] = await database.db
      .insert(files)
      .values({ name: 'r.pdf', mediaType: 'application/pdf', content, sizeBytes: content.length, ownerId: person.id })
      .returning()
    expect((await client.get(`/photos/${file?.id}`)).status).toBe(404)
    await database.db.update(people).set({ photoFileId: file?.id }).where(eq(people.id, person.id))
    expect((await client.get(`/photos/${file?.id}`)).status).toBe(404)
  })
})
