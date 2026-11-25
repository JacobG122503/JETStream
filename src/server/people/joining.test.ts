// Asking to join, invites, reset links and what administrators do about them, through the API.
// What others may do, and links whose maker loses access: linkAccess.test.ts.
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HelpRequest, InviteRow, JoinRequests, NewLink, PersonRow, SessionInfo } from '../../shared/api'
import { cleanUp } from '../auth/cleanUp'
import type { Database } from '../db'
import {
  activityLog, clients, companySettings, helpRequests, invites, outboxMessages, passwordResets, people, personCredentials, projects,
  roles, sessions, signInAttempts,
} from '../db/schema'
import { verifyPassword } from '../security/passwords'
import { accounts, browser, type Browser, goodPassword, signedIn, standInSender, testApp, testClock } from '../testing/apiClient'
import { type Make, makeRecords } from '../testing/records'
import { createTestDatabase } from '../testing/testDatabase'
import { isProjectMember } from './membership'

let database: Database
let account: ReturnType<typeof accounts>
let make: Make
let roleIds: Record<string, number>
beforeAll(async () => {
  database = await createTestDatabase()
  account = accounts(database.db)
  make = makeRecords(database.db)
  roleIds = Object.fromEntries((await database.db.select().from(roles)).map(({ key, id }) => [key ?? '', id] as const))
})
afterAll(() => database.close())
beforeEach(async () => {
  await database.db.delete(signInAttempts)
  await database.db.update(companySettings).set({ signUpEnabled: true })
})

const errorCode = (response: { body: unknown }) => (response.body as { error?: { code: string } }).error?.code
const summary = (response: { status: number; body: unknown }) => [response.status, errorCode(response)]
const gone = [410, 'link_invalid']
let counter = 0
const newEmail = () => `new${++counter}@client.example`
const findPerson = async (email: string) => (await database.db.select().from(people).where(eq(people.email, email)))[0]
const tokenIn = (link: string) => link.split('#')[1] ?? ''
const logOf = async (personId: number) =>
  (await database.db.select().from(activityLog).where(eq(activityLog.subjectId, personId))).map(({ action, actorId }) => [action, actorId])
const messagesTo = async (email: string) =>
  (await database.db.select().from(outboxMessages)).filter(({ recipients }) => recipients.some((to) => to.email === email))
const signUpAs = (email: string, more: object = {}) => ({ name: 'New Person', email, password: 'a good password', timeZone: 'UTC', ...more })

async function setUp(options: Partial<Parameters<typeof testApp>[0]> = {}) {
  const clock = testClock()
  const app = testApp({ db: database.db, now: clock.now, publicUrl: 'https://time.example.com/', ...options })
  const admin = await account('administrator')
  return { clock, app, admin, office: await signedIn(app, admin.email), stranger: () => browser(app) }
}

describe('asking to join', () => {
  it('waits for an administrator, who chooses role, clients and projects', async () => {
    const { office, stranger, admin, app } = await setUp()
    const { client, project } = await make.workplace()
    const other = await make.project({ clientId: client.id })
    const answer = await stranger().post('/sign-up', signUpAs('New.Person@Example.com'))
    expect([answer.status, answer.body]).toEqual([202, { status: 'received' }])
    const person = await findPerson('new.person@example.com')
    expect(person).toMatchObject({ status: 'pending', roleId: roleIds.member, timeZone: 'UTC' })
    const waiting = await signedIn(app, 'new.person@example.com', 'a good password')
    expect(summary(await waiting.get('/account'))).toEqual([403, 'pending_approval'])

    const { body } = (await office.get('/requests')) as { body: JoinRequests }
    expect(body.requests).toContainEqual({
      id: person?.id, name: 'New Person', email: 'new.person@example.com', requestedAt: '2026-03-02T15:00:00.000Z',
    })
    const decision = { roleId: roleIds.member, clientIds: [client.id], projectIds: [project.id] }
    const approved = await office.post(`/requests/${person?.id}/approve`, decision)
    expect((approved.body as JoinRequests).requests.map(({ id }) => id)).not.toContain(person?.id)
    expect((await waiting.get('/account')).status).toBe(200)
    expect(await isProjectMember(database.db, person?.id ?? 0, project.id)).toBe(true)
    expect(await isProjectMember(database.db, person?.id ?? 0, other.id)).toBe(false)
    expect(await logOf(person?.id ?? 0)).toEqual([['approved', admin.id]])
    expect((await messagesTo('new.person@example.com')).map(({ kind, status }) => [kind, status])).toEqual([['sign_up_approved', 'captured']])
    expect(summary(await office.post(`/requests/${person?.id}/approve`, decision))).toEqual([409, 'already_handled'])
  })

  it('answers the same for an address that is taken or invited, changes nothing, and tells its owner', async () => {
    const { office, stranger } = await setUp()
    const owner = await account('manager')
    const invited = newEmail()
    await office.post('/invites', { name: 'Ivy', email: invited, roleId: roleIds.member })
    const free = await stranger().post('/sign-up', signUpAs(newEmail()))
    const passwordOf = () => database.db.select().from(personCredentials).where(eq(personCredentials.personId, owner.id))
    const [before, passwordBefore] = [await findPerson(owner.email), await passwordOf()]
    for (const email of [owner.email.toUpperCase(), invited]) {
      const answer = await stranger().post('/sign-up', signUpAs(email, { name: 'Evil text' }))
      expect([answer.status, answer.text]).toEqual([free.status, free.text])
      const notice = (await messagesTo(email.toLowerCase())).find(({ kind }) => kind === 'sign_up_notice')
      expect(notice?.body).toContain('Nothing was changed')
      expect(notice?.body).not.toContain('Evil')
    }
    expect(await findPerson(owner.email)).toEqual(before)
    expect(await passwordOf()).toEqual(passwordBefore)
    expect(await findPerson(invited)).toBeUndefined()
  })

  it('acts once when sent twice at the same time', async () => {
    const { stranger } = await setUp()
    const email = newEmail()
    const answers = await Promise.all([1, 2].map(() => stranger().post('/sign-up', signUpAs(email))))
    expect(answers.map(({ status }) => status)).toEqual([202, 202])
    expect(await database.db.select().from(people).where(eq(people.email, email))).toHaveLength(1)
  })

  it.each([
    [{ name: ' ' }, 'name'], [{ name: 'x'.repeat(101) }, 'name'], [{ name: 'a\u0007b' }, 'name'], [{ email: 'nope' }, 'email'],
    [{ email: 'a@b' }, 'email'], [{ email: 'a b@c.example' }, 'email'], [{ email: 'é@c.example' }, 'email'], [{ password: 'short' }, 'password'],
    [{ password: 7 }, 'password'], [{ timeZone: 'Mars/Olympus' }, 'timeZone'], [{ timeZone: '+01:00' }, 'timeZone'], [{ timeZone: '' }, 'timeZone'],
  ])('refuses %j, naming the field', async (more, field) => {
    const { stranger } = await setUp()
    const response = await stranger().post('/sign-up', signUpAs(newEmail(), more))
    expect(summary(response)).toEqual([400, 'invalid_input'])
    expect(Object.keys((response.body as { error: { fields: object } }).error.fields)).toEqual([field])
  })

  it('is refused while switched off, and while nobody could approve', async () => {
    const { office, stranger, admin } = await setUp()
    const open = async () => ((await stranger().get('/session')).body as SessionInfo).signUpOpen
    expect(await open()).toBe(true)
    expect((await office.put('/requests/enabled', { enabled: false })).body).toMatchObject({ enabled: false })
    expect(await open()).toBe(false)
    const email = newEmail()
    expect(summary(await stranger().post('/sign-up', signUpAs(email)))).toEqual([403, 'sign_up_closed'])
    expect(await findPerson(email)).toBeUndefined()
    const { link } = (await office.post('/invites', { name: 'Ida', email, roleId: roleIds.member })).body as NewLink
    expect((await stranger().post('/invite/check', { token: tokenIn(link) })).status).toBe(200)
    await office.put('/requests/enabled', { enabled: true })
    expect(await database.db.select().from(activityLog).where(and(eq(activityLog.action, 'sign_up_switched'), eq(activityLog.actorId, admin.id)))).toHaveLength(2)
    const administrators = await database.db.select({ id: people.id }).from(people).where(eq(people.roleId, roleIds.administrator ?? 0))
    const setAll = (status: 'active' | 'archived') => Promise.all(administrators.map(({ id }) => database.db.update(people).set({ status }).where(eq(people.id, id))))
    await setAll('archived')
    expect(await open()).toBe(false)
    expect(summary(await stranger().post('/sign-up', signUpAs(newEmail())))).toEqual([403, 'sign_up_closed'])
    await setAll('active')
  })

  it('declining removes the person with sessions, so that the address can be used again', async () => {
    const { office, stranger, app, admin } = await setUp()
    const email = newEmail()
    await stranger().post('/sign-up', signUpAs(email))
    const person = await findPerson(email)
    const waiting = await signedIn(app, email, 'a good password')
    expect((await office.post(`/requests/${person?.id}/decline`)).status).toBe(200)
    expect(await findPerson(email)).toBeUndefined()
    expect(await database.db.select().from(sessions).where(eq(sessions.personId, person?.id ?? 0))).toEqual([])
    expect((await waiting.get('/session')).body).toMatchObject({ person: null })
    expect(await logOf(person?.id ?? 0)).toEqual([['declined', admin.id]])
    expect((await messagesTo(email)).map(({ kind }) => kind)).toEqual(['sign_up_declined'])
    expect(summary(await office.post(`/requests/${person?.id}/decline`))).toEqual([409, 'already_handled'])
    expect(summary(await office.post(`/requests/${person?.id}/approve`, { roleId: roleIds.member }))).toEqual([409, 'already_handled'])
    await stranger().post('/sign-up', signUpAs(email))
    expect(await findPerson(email)).toMatchObject({ status: 'pending' })
  })

  it('is decided by one of two administrators', async () => {
    const { office, stranger, app } = await setUp()
    const second = await signedIn(app, (await account('administrator')).email)
    const email = newEmail()
    await stranger().post('/sign-up', signUpAs(email))
    const id = (await findPerson(email))?.id
    const answers = await Promise.all([
      office.post(`/requests/${id}/approve`, { roleId: roleIds.manager }),
      second.post(`/requests/${id}/decline`),
    ])
    expect(answers.map(summary).sort()).toEqual([[200, undefined], [409, 'already_handled']])
  })

  it('never touches people who are not waiting', async () => {
    const { office } = await setUp()
    const member = await account()
    for (const path of ['approve', 'decline']) {
      expect(summary(await office.post(`/requests/${member.id}/${path}`, { roleId: roleIds.administrator }))).toEqual([409, 'already_handled'])
    }
    expect(await findPerson(member.email)).toMatchObject({ status: 'active', roleId: roleIds.member })
  })

  it('is limited to 20 an hour from one address', { timeout: 30_000 }, async () => {
    const { stranger, clock } = await setUp()
    for (let i = 0; i < 20; i++) expect((await stranger().post('/sign-up', signUpAs(newEmail()))).status).toBe(202)
    const refused = await stranger().post('/sign-up', signUpAs(newEmail()))
    expect(summary(refused)).toEqual([429, 'too_many_attempts'])
    expect(refused.headers['retry-after']).toBe('3600')
    clock.forward(61)
    expect((await stranger().post('/sign-up', signUpAs(newEmail()))).status).toBe(202)
  })
})

describe('invites', () => {
  const invite = async (office: Browser, more: object = {}) => {
    const email = newEmail()
    const response = await office.post('/invites', { name: 'Ivy Invited', email, roleId: roleIds.manager, ...more })
    expect(response.status, response.text).toBe(201)
    return { email, ...(response.body as NewLink) }
  }
  const accept = (client: Browser, link: string, more: object = {}) =>
    client.post('/invite/accept', { token: tokenIn(link), name: 'Ivy Accepted', password: 'a good password', timeZone: 'Europe/Berlin', ...more })
  const rowsOf = async (office: Browser, email: string) =>
    ((await office.get('/invites')).body as { invites: InviteRow[] }).invites.filter((row) => row.email === email)

  it('make the person active with role and assignments, sign them in, and work once', async () => {
    const { office, stranger, admin } = await setUp()
    const { client, project } = await make.workplace()
    const { email, link, emailed } = await invite(office, { clientIds: [client.id], projectIds: [project.id] })
    expect(link).toMatch(/^https:\/\/time\.example\.com\/invite#[\w-]{43}$/)
    expect(emailed).toBe(false)
    const guest = stranger()
    for (let i = 0; i < 2; i++) {
      expect((await guest.post('/invite/check', { token: tokenIn(link) })).body).toEqual({
        company: 'JET Engineering', companyTimeZone: 'America/Chicago', name: 'Ivy Invited', email, role: 'Project Manager',
      })
    }
    expect(summary(await accept(guest, link, { password: 'short' }))).toEqual([400, 'invalid_input'])
    expect(summary(await accept(guest, link, { password: email }))).toEqual([400, 'invalid_input'])
    const accepted = await accept(guest, link)
    expect(accepted.body).toMatchObject({ person: { name: 'Ivy Accepted', email, role: { name: 'Project Manager' }, status: 'active', timeZone: 'Europe/Berlin' } })
    expect((await guest.get('/account')).status).toBe(200)
    const person = await findPerson(email)
    expect(await isProjectMember(database.db, person?.id ?? 0, project.id)).toBe(true)
    expect(summary(await accept(stranger(), link))).toEqual(gone)
    expect(summary(await stranger().post('/invite/check', { token: tokenIn(link) }))).toEqual(gone)
    expect(await rowsOf(office, email)).toMatchObject([{ status: 'accepted', invitedBy: admin.name, role: 'Project Manager' }])
    expect(await logOf(person?.id ?? 0)).toEqual([['invite_accepted', person?.id]])
    const invited = await database.db.select().from(activityLog).where(eq(activityLog.action, 'invited'))
    expect(invited.some(({ summary: text, actorId }) => text.includes(email) && actorId === admin.id)).toBe(true)
  })

  it('answer all the same when they do not work, without using them up', async () => {
    const { office, stranger, clock, admin, app } = await setUp()
    const second = await account('administrator')
    const [revoked, replaced, voided] = [await invite(office), await invite(office), await invite(office)]
    // Made by someone who keeps their access.
    const expired = await invite(await signedIn(app, second.email))
    const [row] = await rowsOf(office, revoked.email)
    expect((await office.post(`/invites/${row?.id}/revoke`)).status).toBe(200)
    expect(summary(await office.post(`/invites/${row?.id}/revoke`))).toEqual([409, 'already_handled'])
    expect(summary(await office.post(`/invites/${row?.id}/link`))).toEqual([409, 'already_handled'])
    const [old] = await rowsOf(office, replaced.email)
    const fresh = (await office.post(`/invites/${old?.id}/link`)).body as NewLink
    expect((await stranger().post('/invite/check', { token: tokenIn(fresh.link) })).status).toBe(200)
    await database.db.update(people).set({ roleId: roleIds.manager }).where(eq(people.id, admin.id))
    const answers = new Set<string>()
    const tokens = [tokenIn(revoked.link), tokenIn(replaced.link), tokenIn(voided.link), 'x'.repeat(43), '', 'x', 7, null, { a: 1 }]
    for (const token of tokens) {
      for (const path of ['/invite/check', '/reset-password/check']) {
        const response = await stranger().post(path, { token })
        expect(summary(response)).toEqual(gone)
        answers.add(response.text)
      }
      await database.db.delete(signInAttempts)
    }
    expect((await stranger().post('/invite/check', { token: tokenIn(expired.link) })).status).toBe(200)
    clock.forward(7 * 24 * 60 - 1)
    expect((await stranger().post('/invite/check', { token: tokenIn(expired.link) })).status).toBe(200)
    clock.forward(2)
    const late = await accept(stranger(), expired.link)
    expect(summary(late)).toEqual(gone)
    answers.add(late.text)
    expect(answers.size).toBe(1)
    const again = await signedIn(testApp({ db: database.db, now: clock.now }), second.email)
    expect(await rowsOf(again, expired.email)).toMatchObject([{ status: 'expired' }])
    // The link is erased, the invite stays in the list and can get a new link.
    await cleanUp({ db: database.db, now: clock.now })
    const [erased] = await database.db.select().from(invites).where(eq(invites.email, expired.email))
    expect(erased?.tokenHash).toBeNull()
    expect(await rowsOf(again, expired.email)).toMatchObject([{ status: 'expired' }])
    const renewed = await again.post(`/invites/${erased?.id}/link`)
    expect((await accept(stranger(), (renewed.body as NewLink).link)).status).toBe(200)
  })

  it('end with whoever made them, and then make way', async () => {
    const { office, stranger, app, admin } = await setUp()
    const { email, link } = await invite(office)
    await database.db.update(people).set({ status: 'archived' }).where(eq(people.id, admin.id))
    expect(summary(await accept(stranger(), link))).toEqual(gone)
    const second = await signedIn(app, (await account('administrator')).email)
    expect(await rowsOf(second, email)).toMatchObject([{ status: 'void' }])
    const again = await second.post('/invites', { name: 'Ivy', email, roleId: roleIds.member })
    expect(again.status).toBe(201)
    expect((await rowsOf(second, email)).map(({ status }) => status)).toEqual(['open', 'revoked'])
    expect((await accept(stranger(), (again.body as NewLink).link)).status).toBe(200)
  })

  it('are accepted by one of two at the same time', async () => {
    const { office, stranger } = await setUp()
    const { email, link } = await invite(office)
    const answers = await Promise.all([1, 2].map(() => accept(stranger(), link)))
    expect(answers.map(summary).sort()).toEqual([[200, undefined], gone])
    expect(await database.db.select().from(people).where(eq(people.email, email))).toHaveLength(1)
  })

  it('leave out clients and projects archived since', async () => {
    const { office, stranger } = await setUp()
    const a = await make.workplace()
    const b = await make.workplace()
    const { email, link } = await invite(office, { clientIds: [a.client.id, b.client.id], projectIds: [a.project.id, b.project.id] })
    await database.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, a.project.id))
    await database.db.update(clients).set({ archivedAt: new Date() }).where(eq(clients.id, b.client.id))
    expect((await accept(stranger(), link)).status).toBe(200)
    const id = (await findPerson(email))?.id ?? 0
    expect(await isProjectMember(database.db, id, a.project.id)).toBe(false)
    expect(await isProjectMember(database.db, id, b.project.id)).toBe(false)
    const { body } = (await office.get(`/people/${id}`)) as { body: { clients: { id: number; assigned: boolean }[] } }
    expect(body.clients.filter(({ assigned }) => assigned).map(({ id: clientId }) => clientId)).toEqual([a.client.id])
  })

  it('are refused with the reason', async () => {
    const { office, stranger } = await setUp()
    const pending = newEmail()
    await stranger().post('/sign-up', signUpAs(pending))
    const { email: open } = await invite(office)
    const cases: [string, string][] = [
      [(await account()).email, 'has_password'],
      [(await make.person({ status: 'archived' })).email, 'archived'],
      [pending, 'pending_request'],
      [open.toUpperCase(), 'open_invite'],
    ]
    for (const [email, code] of cases) {
      expect(summary(await office.post('/invites', { name: 'X', email, roleId: roleIds.member }))).toEqual([409, code])
    }
    for (const more of [{ roleId: 999 }, { roleId: 'x' }, { email: 'nope' }, { name: '' }, { clientIds: [999_999] }, { projectIds: 'x' }]) {
      expect((await office.post('/invites', { name: 'X', email: newEmail(), roleId: roleIds.member, ...more })).status).toBe(400)
    }
    expect((await office.post('/invites/999999/revoke')).status).toBe(404)
    expect((await office.post('/invites/nope/link')).status).toBe(404)
  })

  it('give a person without a password one, and make no second person', async () => {
    const { office, stranger } = await setUp()
    const person = await make.person({ name: 'Priya Seeded' })
    const response = await office.post('/invites', { name: 'Priya', email: person.email, roleId: roleIds.manager })
    const { link } = response.body as NewLink
    const state = async () =>
      ((await office.get('/people')).body as { people: PersonRow[] }).people.find(({ id }) => id === person.id)?.signIn
    expect(await state()).toBe('invited')
    const guest = stranger()
    expect((await accept(guest, link, { name: 'Priya V' })).body).toMatchObject({ person: { id: person.id, name: 'Priya V' } })
    expect(await state()).toBe('password')
    expect(await database.db.select().from(people).where(eq(people.email, person.email))).toHaveLength(1)
  })

  it('are not accepted for someone who was archived, or while signed in', async () => {
    const { office, stranger } = await setUp()
    const person = await make.person()
    const { link } = (await office.post('/invites', { name: 'P', email: person.email, roleId: roleIds.member })).body as NewLink
    expect(summary(await accept(office, link))).toEqual([409, 'signed_in'])
    await database.db.update(people).set({ status: 'archived' }).where(eq(people.id, person.id))
    expect(summary(await accept(stranger(), link))).toEqual(gone)
  })

  it('block an address for sign-up only while open', async () => {
    const { office, stranger, clock } = await setUp()
    const { email } = await invite(office)
    clock.forward(8 * 24 * 60)
    await stranger().post('/sign-up', signUpAs(email))
    expect(await findPerson(email)).toMatchObject({ status: 'pending' })
    const again = await signedIn(testApp({ db: database.db, now: clock.now }), (await account('administrator')).email)
    const [row] = await rowsOf(again, email)
    expect(summary(await again.post(`/invites/${row?.id}/link`))).toEqual([409, 'pending_request'])
  })

  it('limit links that do not work to 20 in 15 minutes from one address', async () => {
    const { office, stranger, clock } = await setUp()
    const { link } = await invite(office)
    for (let i = 0; i < 20; i++) {
      expect((await stranger().post('/invite/check', { token: tokenIn(link) })).status).toBe(200)
      expect(summary(await stranger().post('/invite/check', { token: 'x'.repeat(43) }))).toEqual(gone)
    }
    expect(summary(await stranger().post('/reset-password/check', { token: 'x' }))).toEqual([429, 'too_many_attempts'])
    expect(summary(await accept(stranger(), link))).toEqual([429, 'too_many_attempts'])
    clock.forward(16)
    expect((await accept(stranger(), link)).status).toBe(200)
  })
})

describe('forgotten passwords', () => {
  const openRequests = async (personId: number) =>
    (await database.db.select().from(helpRequests).where(eq(helpRequests.personId, personId))).filter(({ closedAt }) => closedAt === null)

  it('become one help request, and the answer never tells', async () => {
    const { office, stranger } = await setUp()
    const person = await account()
    const others = [await account('member', { status: 'archived' }), await account('member', { status: 'pending' })]
    const answers = new Set<string>()
    for (const email of [person.email, ` ${person.email.toUpperCase()}`, 'ghost@jet.example', ...others.map((other) => other.email)]) {
      const response = await stranger().post('/forgot-password', { email })
      expect(response.status).toBe(202)
      answers.add(response.text)
    }
    expect(answers.size).toBe(1)
    expect(await openRequests(person.id)).toHaveLength(1)
    for (const other of others) expect(await openRequests(other.id)).toHaveLength(0)
    const { body } = (await office.get('/help-requests')) as { body: { requests: HelpRequest[] } }
    expect(body.requests.filter(({ personId }) => personId === person.id)).toMatchObject([{ name: person.name, hasPassword: true }])
    expect(await database.db.select().from(passwordResets).where(eq(passwordResets.personId, person.id))).toEqual([])
  })

  it('lead to a link that sets a password once, ends all sessions and closes the request', async () => {
    const { office, stranger, app, admin } = await setUp()
    const person = await account()
    const signed = await signedIn(app, person.email)
    await stranger().post('/forgot-password', { email: person.email })
    const first = (await office.post(`/people/${person.id}/reset-link`)).body as NewLink
    expect(first.link).toMatch(/^https:\/\/time\.example\.com\/reset-password#[\w-]{43}$/)
    expect(await openRequests(person.id)).toEqual([])
    const second = (await office.post(`/people/${person.id}/reset-link`)).body as NewLink
    expect(summary(await stranger().post('/reset-password/check', { token: tokenIn(first.link) }))).toEqual(gone)
    const token = tokenIn(second.link)
    for (let i = 0; i < 2; i++) expect((await stranger().post('/reset-password/check', { token })).body).toEqual({ email: person.email })
    expect(summary(await stranger().post('/reset-password/use', { token, password: 'jetdemo123' }))).toEqual([400, 'invalid_input'])
    expect(summary(await signed.post('/reset-password/use', { token, password: 'another password' }))).toEqual([409, 'signed_in'])
    const used = await stranger().post('/reset-password/use', { token, password: 'another password' })
    expect([used.status, used.get('Set-Cookie')]).toEqual([200, undefined])
    expect((await signed.get('/account')).status).toBe(401)
    expect(summary(await stranger().post('/reset-password/use', { token, password: 'a third password' }))).toEqual(gone)
    expect((await stranger().signIn(person.email, goodPassword)).status).toBe(401)
    expect((await stranger().signIn(person.email, 'another password')).status).toBe(200)
    expect(await logOf(person.id)).toEqual([['reset_link_made', admin.id], ['reset_link_made', admin.id], ['password_reset', person.id]])
    expect((await messagesTo(person.email)).map(({ kind }) => kind)).toEqual(['password_reset', 'password_reset', 'password_changed'])
  })

  it('links last an hour, and end with the person or the administrator', async () => {
    const { office, stranger, clock, admin } = await setUp()
    const person = await account()
    const make1 = async () => tokenIn(((await office.post(`/people/${person.id}/reset-link`)).body as NewLink).link)
    const check = async (token: string) => (await stranger().post('/reset-password/check', { token })).status
    const token = await make1()
    clock.forward(59)
    expect(await check(token)).toBe(200)
    clock.forward(1)
    expect(await check(token)).toBe(410)
    const next = await make1()
    await database.db.update(people).set({ status: 'archived' }).where(eq(people.id, person.id))
    expect(await check(next)).toBe(410)
    await database.db.update(people).set({ status: 'active' }).where(eq(people.id, person.id))
    expect(await check(next)).toBe(200)
    await database.db.update(people).set({ roleId: roleIds.member }).where(eq(people.id, admin.id))
    expect(await check(next)).toBe(410)
    clock.forward(61)
    await cleanUp({ db: database.db, now: clock.now })
    expect(await database.db.select().from(passwordResets).where(eq(passwordResets.personId, person.id))).toEqual([])
  })

  it('cannot be reset for people without a password, not active, or unknown', async () => {
    const { office } = await setUp()
    expect(summary(await office.post(`/people/${(await make.person()).id}/reset-link`))).toEqual([409, 'no_password'])
    for (const status of ['archived', 'pending'] as const) {
      expect(summary(await office.post(`/people/${(await account('member', { status })).id}/reset-link`))).toEqual([409, 'not_active'])
    }
    expect((await office.post('/people/999999/reset-link')).status).toBe(404)
  })

  it('are limited to 3 per email, silently, and 10 per address in an hour', async () => {
    const { stranger, clock } = await setUp()
    const person = await account()
    for (let i = 0; i < 3; i++) {
      await stranger().post('/forgot-password', { email: person.email })
      await database.db.delete(helpRequests).where(eq(helpRequests.personId, person.id))
    }
    const fourth = await stranger().post('/forgot-password', { email: person.email })
    expect([fourth.status, fourth.body]).toEqual([202, { status: 'received' }])
    expect(await openRequests(person.id)).toEqual([])
    for (let i = 0; i < 6; i++) expect((await stranger().post('/forgot-password', { email: newEmail() })).status).toBe(202)
    expect(summary(await stranger().post('/forgot-password', { email: newEmail() }))).toEqual([429, 'too_many_attempts'])
    clock.forward(61)
    await stranger().post('/forgot-password', { email: person.email })
    expect(await openRequests(person.id)).toHaveLength(1)
  })

  it('are answered by email where email is delivered', async () => {
    const { sender, messages } = standInSender()
    const { stranger } = await setUp({ email: sender })
    const person = await account()
    expect(((await stranger().get('/session')).body as SessionInfo).emailDelivers).toBe(true)
    const evil = { Host: 'evil.example', 'X-Forwarded-Host': 'evil.example' }
    const answer = await stranger().post('/forgot-password', { email: person.email }, evil)
    const unknown = await stranger().post('/forgot-password', { email: newEmail() }, evil)
    expect([answer.status, answer.text]).toEqual([unknown.status, unknown.text])
    expect(messages).toHaveLength(1)
    const link = /https:\S+/.exec(messages[0]?.text ?? '')?.[0] ?? ''
    expect(link).toMatch(/^https:\/\/time\.example\.com\/reset-password#/)
    expect(await openRequests(person.id)).toEqual([])
    expect((await stranger().post('/reset-password/use', { token: tokenIn(link), password: 'another password' })).status).toBe(200)
  })
})

describe('messages', () => {
  it('hold no working link when captured, and one when delivered', async () => {
    const { office } = await setUp()
    const person = await account()
    const email = newEmail()
    const links = [
      ((await office.post('/invites', { name: 'Ivy', email, roleId: roleIds.member })).body as NewLink).link,
      ((await office.post(`/people/${person.id}/reset-link`)).body as NewLink).link,
    ]
    const stored = JSON.stringify(await database.db.select().from(outboxMessages))
    const logged = JSON.stringify(await database.db.select().from(activityLog))
    for (const link of links) {
      for (const text of [stored, logged]) expect(text).not.toContain(tokenIn(link))
    }
    for (const to of [email, person.email]) {
      const [message] = await messagesTo(to)
      expect(message).toMatchObject({ status: 'captured', sentAt: null })
      expect(message?.body).toContain('[link hidden]')
      expect(message?.body).not.toMatch(/https?:/)
    }

    const { sender, messages } = standInSender()
    const app = testApp({ db: database.db, email: sender, basePath: '/jetstream/', publicUrl: 'https://example.com/jetstream/' })
    const admin = await account('administrator')
    const at = await signedIn(app, admin.email, goodPassword, '/jetstream')
    const response = await at.post('/invites', { name: 'Ivy', email: newEmail(), roleId: roleIds.member }, { Host: 'evil.example' })
    expect(response.body).toMatchObject({ emailed: true })
    expect(messages[0]?.text).toContain((response.body as NewLink).link)
    expect((response.body as NewLink).link).toMatch(/^https:\/\/example\.com\/jetstream\/invite#/)
    const guest = browser(app, '/jetstream')
    expect((await guest.post('/invite/check', { token: tokenIn(messages[0]?.link ?? '') })).status).toBe(200)
  })

  it('that cannot be sent change nothing else', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { office } = await setUp({ email: { delivers: true, send: () => Promise.reject(new Error('smtp')) } })
    const email = newEmail()
    expect((await office.post('/invites', { name: 'Ivy', email, roleId: roleIds.member })).status).toBe(201)
  })
})

it('stores nothing that lets a reader of the database sign in', async () => {
  const [credential] = await database.db.select().from(personCredentials)
  expect(credential?.passwordHash).toMatch(/^\$scrypt\$/)
  expect(await verifyPassword(goodPassword, credential?.passwordHash ?? '')).toBe(true)
})
