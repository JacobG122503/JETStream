// Changes of access at the same time. The embedded database has one connection, so there
// transactions run in turn and this proves results only. With TEST_DATABASE_URL the same runs
// against a PostgreSQL server over separate connections.
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { NewLink, PersonAccessDetails, RoleDetails } from '../../shared/api'
import { keepAnAdministrator, lockForAccessChange } from '../access/grants'
import { loadActor } from '../access/actor'
import { type Database, runTransaction } from '../db'
import { invites, passwordResets, people, personCredentials, roles, signInAttempts } from '../db/schema'
import { accounts, browser, type Browser, signedIn, testApp } from '../testing/apiClient'
import { makeRecords } from '../testing/records'
import { openTestServer, parseTestDatabaseUrl, testServerTimeoutMs } from '../testing/realServer'
import { createTestDatabase } from '../testing/testDatabase'

const serverUrl = parseTestDatabaseUrl(process.env)
const rounds = 5

describe.each([
  { name: 'embedded database', skip: false, open: createTestDatabase },
  { name: 'PostgreSQL server, separate connections', skip: serverUrl === undefined, open: () => openTestServer(serverUrl ?? '') },
])('changes of access at the same time: $name', { timeout: 60_000 }, ({ skip, open }) => {
  let database: Database
  let account: ReturnType<typeof accounts>
  let app: ReturnType<typeof testApp>
  beforeAll(async () => {
    if (skip) return
    database = await open()
    account = accounts(database.db)
    app = testApp({ db: database.db })
  }, testServerTimeoutMs)
  afterAll(() => database?.close())
  beforeEach(async () => {
    if (!skip) await database.db.delete(signInAttempts)
  })
  const on = it.skipIf(skip)

  const codeOf = (response: { status: number; body: unknown }) => (response.body as { error?: { code: string } }).error?.code ?? response.status
  const roleId = async (key: 'administrator' | 'manager' | 'member') => (await makeRecords(database.db).builtInRole(key)).id
  const prepare = async (client: Browser, id: number, role: number) => {
    const { state } = (await client.get(`/people/${id}/access`)).body as PersonAccessDetails
    return () => client.put(`/people/${id}/access`, { state, roleId: role, extras: [], managedPersonIds: [], managedProjectIds: [] })
  }
  /** Only those made in this test are administrators with a password. */
  const onlyAdministrators = async (count: number) => {
    const before = await database.db.select({ id: people.id }).from(people).where(eq(people.roleId, await roleId('administrator')))
    const ids = before.map(({ id }) => id)
    if (ids.length > 0) await database.db.update(people).set({ roleId: await roleId('member') }).where(inArray(people.id, ids))
    const list = []
    for (let i = 0; i < count; i++) list.push(await account('administrator'))
    return list
  }

  on('two administrators remove each other: one is left', async () => {
    const member = await roleId('member')
    for (let round = 0; round < rounds; round++) {
      await database.db.delete(signInAttempts)
      const [a, b] = await onlyAdministrators(2)
      if (!a || !b) throw new Error('Two are needed')
      const [first, second] = [await signedIn(app, a.email), await signedIn(app, b.email)]
      const [removeB, removeA] = [await prepare(first, b.id, member), await prepare(second, a.id, member)]
      const answers = (await Promise.all([removeB(), removeA()])).map(codeOf)
      expect(answers.map(String).sort()).toEqual(['200', 'forbidden'])
      expect(await database.db.$count(people, eq(people.roleId, await roleId('administrator')))).toBe(1)
    }
  })

  on('the guard holds for two at once that would leave none', async () => {
    const [a, b, actor] = await onlyAdministrators(3)
    if (!a || !b || !actor) throw new Error('Three are needed')
    await database.db.delete(personCredentials).where(eq(personCredentials.personId, actor.id))
    const archive = (id: number) =>
      runTransaction(database.db, async (tx) => {
        await lockForAccessChange(tx, await loadActor(tx, actor.id), { people: [id] })
        await keepAnAdministrator(tx, id)
        await tx.update(people).set({ status: 'archived' }).where(eq(people.id, id))
      })
    const results = await Promise.allSettled([archive(a.id), archive(b.id)])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({ reason: { code: 'last_administrator' } })
  })

  on('nothing is given by someone who has lost the permission', async () => {
    const [admin] = await onlyAdministrators(1)
    const office = await signedIn(app, admin?.email ?? '')
    const member = await roleId('member')
    for (let round = 0; round < rounds; round++) {
      await database.db.delete(signInAttempts)
      const helper = await account('administrator')
      const client = await signedIn(app, helper.email)
      const target = await makeRecords(database.db).person()
      const role = await makeRecords(database.db).role({ 'outbox.view': 'all' })
      const [give, lose] = [await prepare(client, target.id, role.id), await prepare(office, helper.id, member)]
      const [given, lost] = await Promise.all([give(), lose()])
      expect(codeOf(lost)).toBe(200)
      expect([200, 'forbidden']).toContain(codeOf(given))
      const [row] = await database.db.select().from(people).where(eq(people.id, target.id))
      expect(row?.roleId).toBe(codeOf(given) === 200 ? role.id : member)
    }
  })

  on('no link is left over from the moment of losing access', async () => {
    const [admin] = await onlyAdministrators(1)
    const office = await signedIn(app, admin?.email ?? '')
    const member = await roleId('member')
    for (let round = 0; round < rounds; round++) {
      await database.db.delete(signInAttempts)
      const helper = await account('administrator')
      const client = await signedIn(app, helper.email)
      const target = await account('member')
      const lose = await prepare(office, helper.id, member)
      const [link, invite, lost] = await Promise.all([
        client.post(`/people/${target.id}/reset-link`),
        client.post('/invites', { name: 'Ivy', email: `race${round}.${target.id}@client.example`, roleId: member }),
        lose(),
      ])
      expect(codeOf(lost)).toBe(200)
      const token = (response: { body: unknown }) => (response.body as Partial<NewLink>).link?.split('#')[1]
      if (link.status === 201) expect((await browser(app).post('/reset-password/check', { token: token(link) })).status).toBe(410)
      if (invite.status === 201) expect((await browser(app).post('/invite/check', { token: token(invite) })).status).toBe(410)
      const resets = await database.db.select().from(passwordResets).where(eq(passwordResets.createdBy, helper.id))
      expect(resets.filter(({ revokedAt }) => revokedAt === null)).toEqual([])
      const left = await database.db.select().from(invites).where(eq(invites.createdBy, helper.id))
      expect(left.filter(({ endedAt }) => endedAt === null)).toEqual([])
    }
  })

  on('a role is not given while it is deleted', async () => {
    const [admin] = await onlyAdministrators(1)
    const office = await signedIn(app, admin?.email ?? '')
    const member = await roleId('member')
    for (let round = 0; round < rounds; round++) {
      const role = await makeRecords(database.db).role({ 'outbox.view': 'all' })
      const target = await makeRecords(database.db).person()
      const give = await prepare(office, target.id, role.id)
      const { version } = (await office.get(`/roles/${role.id}`)).body as RoleDetails
      const [given, deleted] = await Promise.all([give(), office.post(`/roles/${role.id}/delete`, { version, replacementId: member })])
      expect(codeOf(deleted)).toBe(200)
      expect([200, 'invalid_input']).toContain(codeOf(given))
      const [row] = await database.db.select().from(people).where(eq(people.id, target.id))
      expect(row?.roleId).toBe(member)
      expect(await database.db.select().from(roles).where(eq(roles.id, role.id))).toEqual([])
    }
  })
})
