// Custom roles, through the API.
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { InviteRow, NewLink, RoleDetails, RoleSummary } from '../../shared/api'
import { everything, type Grants, managerGrants, writeGrants } from '../../shared/permissions'
import type { Database } from '../db'
import { activityLog, invites, people, roles, signInAttempts } from '../db/schema'
import { accounts, browser, type Browser, signedIn, testApp, testClock } from '../testing/apiClient'
import { type Make, makeRecords } from '../testing/records'
import { createTestDatabase } from '../testing/testDatabase'

let database: Database
let account: ReturnType<typeof accounts>
let make: Make
let app: ReturnType<typeof testApp>
let clock: ReturnType<typeof testClock>
let office: Browser
let adminId: number
let roleIds: Record<string, number>
beforeAll(async () => {
  database = await createTestDatabase()
  account = accounts(database.db)
  make = makeRecords(database.db)
  clock = testClock()
  app = testApp({ db: database.db, now: clock.now })
  const admin = await account('administrator')
  adminId = admin.id
  office = await signedIn(app, admin.email)
  roleIds = Object.fromEntries((await database.db.select().from(roles)).map(({ key, id }) => [key ?? '', id] as const))
})
afterAll(() => database.close())
beforeEach(() => database.db.delete(signInAttempts))

const summary = (response: { status: number; body: unknown }) => [
  response.status, (response.body as { error?: { code: string } }).error?.code,
]
const fieldsOf = (response: { body: unknown }) => Object.keys((response.body as { error: { fields?: object } }).error.fields ?? {})
const ok = [200, undefined]
let counter = 0
const newName = () => `Scheduler ${++counter}`
const scheduling: Grants = { 'schedule.view': 'all', 'schedule.edit': 'all' }
const create = async (grants: Grants = scheduling, client = office, name = newName()) => {
  const response = await client.post('/roles', { name, description: 'Plans the weeks', grants })
  expect(summary(response)).toEqual([201, undefined])
  return response.body as RoleDetails
}
const list = async () => ((await office.get('/roles')).body as { roles: RoleSummary[] }).roles
const read = async (id: number, client = office) => (await client.get(`/roles/${id}`)).body as RoleDetails
const save = (role: RoleDetails, more: object = {}, client = office) =>
  client.put(`/roles/${role.id}`, { name: role.name, description: role.description, grants: role.grants, version: role.version, ...more })
const remove = (role: RoleDetails, replacementId: number | null = null, client = office) =>
  client.post(`/roles/${role.id}/delete`, { version: role.version, replacementId })
const stored = async () => JSON.stringify(await database.db.select().from(roles).orderBy(roles.id))
const logOf = (id: number) =>
  database.db.select().from(activityLog).where(and(eq(activityLog.subjectType, 'role'), eq(activityLog.subjectId, id))).orderBy(activityLog.id)
const hr: Grants = { 'people.view': 'all', 'people.manage': 'all', 'roles.manage': 'all' }

describe('roles', () => {
  it('are listed with description, kind and number of people, built-in ones first', async () => {
    const role = await create()
    await make.person({ roleId: role.id })
    await make.person({ roleId: role.id, status: 'archived' })
    const all = await list()
    expect(all.slice(0, 3).map(({ key, builtIn }) => [key, builtIn])).toEqual([['administrator', true], ['manager', true], ['member', true]])
    for (const { description } of all.slice(0, 3)) expect(description).not.toBe('')
    expect(all.find(({ id }) => id === role.id)).toEqual({ id: role.id, key: null, builtIn: false, name: role.name, description: 'Plans the weeks', people: 2 })
    expect(all.find(({ key }) => key === 'administrator')?.people).toBe(await database.db.$count(people, eq(people.roleId, roleIds.administrator ?? 0)))
  })

  it('show what they give; built-in ones cannot be changed or deleted, by anyone', async () => {
    expect(await read(roleIds.administrator ?? 0)).toMatchObject({ grants: everything(), refusal: 'Built-in roles cannot be changed.' })
    expect(await read(roleIds.manager ?? 0)).toMatchObject({ grants: managerGrants(), refusal: 'Built-in roles cannot be changed.' })
    expect(await read(roleIds.member ?? 0)).toMatchObject({ grants: {} })
    const before = await stored()
    for (const key of ['administrator', 'manager', 'member']) {
      const role = await read(roleIds[key] ?? 0)
      expect((await save(role, { name: 'Renamed' })).status).toBe(403)
      expect((await remove(role, roleIds.member)).status).toBe(403)
    }
    expect(await stored()).toBe(before)
    expect((await office.get('/roles/999999')).status).toBe(404)
    expect((await office.get('/roles/x')).status).toBe(404)
  })

  it('are made, changed and noted with before and after', async () => {
    const name = newName()
    const role = await create(scheduling, office, `  ${name} `)
    expect(role).toMatchObject({ name, grants: scheduling, people: 0, invites: 0, refusal: null, builtIn: false, key: null })
    const changed = await save(role, { name: `${name} x`, description: '', grants: { 'schedule.view': 'managed' } })
    expect(changed.body).toMatchObject({ name: `${name} x`, description: '', grants: { 'schedule.view': 'managed' }, version: 2 })
    const log = await logOf(role.id)
    expect(log).toMatchObject([
      { action: 'role_created', actorId: adminId, changes: { name: [null, name], permissions: [null, ['schedule.view:all', 'schedule.edit:all']] } },
      { action: 'role_changed', actorId: adminId, changes: { name: [name, `${name} x`], permissions: [['schedule.view:all', 'schedule.edit:all'], ['schedule.view:managed']] } },
    ])
    // The same name in other letters is its own.
    expect(summary(await save(changed.body as RoleDetails, { name: name.toUpperCase() }))).toEqual(ok)
  })

  it('refuse a member before looking at what they sent', async () => {
    const client = await signedIn(app, (await account('member')).email)
    expect(summary(await client.post('/roles', {}))).toEqual([403, 'forbidden'])
    expect(summary(await client.get('/roles'))).toEqual([403, 'forbidden'])
  })

  it.each([
    [{ grants: { 'time.fly': 'all' } }, 'grants'], [{ grants: { 'clients.manage': 'managed', 'clients.view': 'managed' } }, 'grants'],
    [{ grants: { 'time.approve': 'managed' } }, 'grants'], [{ grants: { 'time.approve': 'all', 'time.view': 'managed' } }, 'grants'],
    [{ grants: ['time.view:all'] }, 'grants'], [{ grants: undefined }, 'grants'], [{ grants: { 'time.view': 'own' } }, 'grants'],
    [{ name: 'administrator' }, 'name'], [{ name: ' MEMBER ' }, 'name'], [{ name: 'Manager' }, 'name'], [{ name: ' ' }, 'name'], [{ name: 7 }, 'name'],
    [{ name: 'x'.repeat(61) }, 'name'], [{ name: 'a\u0007' }, 'name'], [{ description: 'x'.repeat(201) }, 'description'], [{ description: 7 }, 'description'],
  ])('refuse %j, naming the field, and store nothing', async (more, field) => {
    const role = await create()
    const before = await stored()
    const good = { name: newName(), description: '', grants: scheduling }
    for (const response of [await office.post('/roles', { ...good, ...more }), await save(role, more)]) {
      expect(summary(response)).toEqual([400, 'invalid_input'])
      expect(fieldsOf(response)).toEqual([field])
    }
    expect(await stored()).toBe(before)
  })

  it('have unique names, ignoring case, of up to 60 characters', async () => {
    const role = await create()
    const other = await create()
    for (const response of [
      await office.post('/roles', { name: ` ${role.name.toUpperCase()}`, description: '', grants: {} }), await save(other, { name: role.name.toLowerCase() }),
    ]) {
      expect([summary(response), fieldsOf(response)]).toEqual([[400, 'invalid_input'], ['name']])
    }
    const answers = await Promise.all([1, 2].map(() => office.post('/roles', { name: 'Twice', description: '', grants: {} })))
    expect(answers.map(({ status }) => status).sort()).toEqual([201, 400])
    const long = await office.post('/roles', { name: '\u{1F600}'.repeat(60), description: 'd'.repeat(200), grants: {} })
    expect(long.status).toBe(201)
  })

  it('that hold keys nobody knows give nothing for them, and open', async () => {
    const role = await make.role({}, { permissions: ['old.key', 'old.key:all', 'outbox.view:all'] })
    const person = await account('member', { roleId: role.id })
    const client = await signedIn(app, person.email)
    expect((await client.get('/session')).body).toMatchObject({ person: { permissions: { 'outbox.view': 'all' }, role: { key: null, name: role.name } } })
    expect((await list()).some(({ id }) => id === role.id)).toBe(true)
    const details = await read(role.id)
    expect(details.grants).toEqual({ 'outbox.view': 'all' })
    expect(summary(await save(details))).toEqual(ok)
  })
})

describe('what one lacks', () => {
  it('cannot be put into a role, or taken out of one, and one\'s own role cannot be changed', async () => {
    const person = await account(hr)
    const client = await signedIn(app, person.email)
    const [own] = await database.db.select().from(people).where(eq(people.id, person.id))
    const [more, mine] = [await create({ 'cost.view': 'managed' }), await create({ 'people.view': 'managed' })]
    const ownRole = await read(own?.roleId ?? 0, client)
    expect(ownRole.refusal).toContain('yourself')
    expect((await read(more.id, client)).refusal).toContain('cost rates')
    const before = await stored()
    for (const response of [
      await client.post('/roles', { name: newName(), description: '', grants: { 'cost.view': 'managed' } }),
      await save(ownRole, { grants: { ...hr, 'outbox.view': 'all' } }, client), await save(ownRole, { description: 'x' }, client),
      await remove(ownRole, roleIds.member, client),
      await save(more, { grants: {} }, client), await save(more, { name: newName() }, client), await remove(more, null, client),
      await save(mine, { grants: { 'cost.view': 'managed' } }, client),
    ]) {
      expect(response.status).toBe(403)
    }
    expect(await stored()).toBe(before)
    expect(summary(await save(mine, { grants: { 'people.view': 'all' } }, client))).toEqual(ok)
    const made = await create({ ...hr, 'people.view': 'all' }, client)
    expect(summary(await remove(made, null, client))).toEqual(ok)
  })

  it('cannot be given as a replacement', async () => {
    const client = await signedIn(app, (await account(hr)).email)
    const role = await create({ 'people.view': 'managed' })
    const person = await make.person({ roleId: role.id })
    for (const key of ['manager', 'administrator']) expect((await remove(role, roleIds[key], client)).status).toBe(403)
    expect(summary(await remove(role, roleIds.member, client))).toEqual(ok)
    expect((await database.db.select().from(people).where(eq(people.id, person.id)))[0]?.roleId).toBe(roleIds.member)
  })
})

describe('changing and deleting', () => {
  it('is done by one of two at the same time, and the other is told', async () => {
    const role = await create()
    const answers = await Promise.all([save(role, { description: 'one' }), save(role, { description: 'two' })])
    expect(answers.map(summary).sort()).toEqual([ok, [409, 'stale']])
    const now = await read(role.id)
    expect(summary(await remove(role))).toEqual([409, 'stale'])
    const gone = await Promise.all([remove(now), remove(now)])
    expect(gone.map(summary).sort()).toEqual([ok, [404, 'not_found']])
    expect(summary(await save(now))).toEqual([404, 'not_found'])
  })

  it('acts for the people who hold it at their next request', async () => {
    const role = await create({ 'outbox.view': 'all' })
    const person = await account('member', { roleId: role.id })
    const client = await signedIn(app, person.email)
    expect((await client.get('/people')).status).toBe(403)
    await save(role, { grants: { 'people.view': 'all' } })
    expect((await client.get('/people')).status).toBe(200)
  })

  it('moves people of any status and open invites to the replacement, and needs one while there are any', async () => {
    const role = await create({ 'outbox.view': 'all' })
    const [active, archived] = [await make.person({ roleId: role.id }), await make.person({ roleId: role.id, status: 'archived' })]
    expect((await read(role.id)).people).toBe(2)
    expect(summary(await remove(role))).toEqual([409, 'role_in_use'])
    for (const replacement of [role.id, 999_999]) expect(summary(await remove(role, replacement))).toEqual([400, 'invalid_input'])
    expect(summary(await remove(role, roleIds.manager))).toEqual(ok)
    for (const { id } of [active, archived]) {
      expect((await database.db.select().from(people).where(eq(people.id, id)))[0]?.roleId).toBe(roleIds.manager)
      const [entry] = await database.db.select().from(activityLog).where(and(eq(activityLog.subjectId, id), eq(activityLog.action, 'access_changed')))
      expect(entry).toMatchObject({ actorId: adminId, changes: { role: [role.name, 'Manager'] } })
    }
    expect((await logOf(role.id)).map(({ action }) => action)).toEqual(['role_created', 'role_deleted'])
  })

  it('leaves invites of the past with the name of the role', async () => {
    const role = await create({ 'outbox.view': 'all' })
    const invite = async (email: string) => (await office.post('/invites', { name: 'Ivy', email, roleId: role.id })).body as NewLink
    const rows = async () => ((await office.get('/invites')).body as { invites: InviteRow[] }).invites.filter((row) => row.role === role.name)
    const idOf = async (email: string) => (await database.db.select().from(invites).where(eq(invites.email, email)))[0]?.id
    const [accepted, revoked, open] = [`a${counter}@client.example`, `r${counter}@client.example`, `o${counter}@client.example`]
    const token = (await invite(accepted)).link.split('#')[1]
    await browser(app).post('/invite/accept', { token, name: 'Ivy', password: 'a good password', timeZone: 'UTC' })
    await invite(revoked)
    await office.post(`/invites/${await idOf(revoked)}/revoke`)
    const link = (await invite(open)).link.split('#')[1]
    await database.db.update(people).set({ roleId: roleIds.member }).where(eq(people.email, accepted))
    expect((await read(role.id)).invites).toBe(1)
    expect(summary(await remove(role))).toEqual([409, 'role_in_use'])
    expect(summary(await remove(role, roleIds.member))).toEqual(ok)
    expect((await rows()).map(({ status }) => status).sort()).toEqual(['accepted', 'revoked'])
    expect((await browser(app).post('/invite/check', { token: link })).body).toMatchObject({ role: 'Member' })
  })

  it('an expired invite whose role is gone must be made anew', async () => {
    const role = await create({ 'outbox.view': 'all' })
    const email = `late${counter}@client.example`
    await office.post('/invites', { name: 'Ivy', email, roleId: role.id })
    const [row] = await database.db.update(invites).set({ expiresAt: clock.now() }).where(eq(invites.email, email)).returning()
    expect(summary(await remove(role))).toEqual(ok)
    expect(((await office.get('/invites')).body as { invites: InviteRow[] }).invites.find(({ id }) => id === row?.id)).toMatchObject({ role: role.name, status: 'expired' })
    expect(summary(await office.post(`/invites/${row?.id}/link`))).toEqual([409, 'role_deleted'])
    expect((await office.post('/invites', { name: 'Ivy', email, roleId: roleIds.member })).status).toBe(201)
  })

  it('a deleted or changed role is stored as the code reads it', async () => {
    const role = await create(everything())
    const [row] = await database.db.select().from(roles).where(eq(roles.id, role.id))
    expect(row?.permissions).toEqual(writeGrants(everything()))
  })
})
