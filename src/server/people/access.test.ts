// Who may change whose access, through the API.
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AccessInfo, PersonAccessDetails, PersonDetails, SavedAssignments, SessionInfo } from '../../shared/api'
import { everything, type Grants, managerGrants } from '../../shared/permissions'
import { keepAnAdministrator } from '../access/grants'
import { loadActor, readPersonAccess } from '../access/actor'
import { can } from '../access/decisions'
import { checkManagerFlag, setManagerFlag } from '../access/managerFlags'
import { type Database, runTransaction } from '../db'
import { activityLog, people, personCredentials, personExtras, personManagers, projectMembers, projects, roles, signInAttempts } from '../db/schema'
import { accounts, type Browser, signedIn, testApp, testClock } from '../testing/apiClient'
import { type Make, makeRecords } from '../testing/records'
import { createTestDatabase } from '../testing/testDatabase'
import { isProjectMember } from './membership'

let database: Database
let account: ReturnType<typeof accounts>
let make: Make
let app: ReturnType<typeof testApp>
let office: Browser
let adminId: number
let roleIds: Record<string, number>
beforeAll(async () => {
  database = await createTestDatabase()
  account = accounts(database.db)
  make = makeRecords(database.db)
  app = testApp({ db: database.db, now: testClock().now })
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
const ok = [200, undefined]
const read = async (id: number, client = office) => (await client.get(`/people/${id}/access`)).body as PersonAccessDetails
const inputOf = ({ state, roleId, extras, managedPeople, projects: list }: PersonAccessDetails) => ({
  state, roleId, extras, managedPersonIds: managedPeople.map(({ id }) => id), managedProjectIds: list.filter(({ isManager }) => isManager).map(({ id }) => id),
})
/** Saves a change as the office reads it now, or as the client does. */
const change = async (id: number, more: Partial<ReturnType<typeof inputOf>>, client = office) =>
  client.put(`/people/${id}/access`, { ...inputOf(await read(id)), ...more })
const rowOf = async (id: number) => (await database.db.select().from(people).where(eq(people.id, id)))[0]
const logOf = async (id: number) =>
  database.db.select().from(activityLog).where(and(eq(activityLog.subjectId, id), eq(activityLog.subjectType, 'person'), eq(activityLog.action, 'access_changed'))).orderBy(activityLog.id)
/** Everything about someone's access, to see that nothing changed. */
const accessOf = async (id: number) =>
  JSON.stringify([
    (await rowOf(id))?.roleId, await database.db.select().from(personExtras).where(eq(personExtras.personId, id)),
    await database.db.select().from(personManagers).where(eq(personManagers.managerId, id)),
    await database.db.select({ projectId: projectMembers.projectId, isManager: projectMembers.isManager, removedAt: projectMembers.removedAt }).from(projectMembers).where(eq(projectMembers.personId, id)),
  ])
const hr: Grants = { 'people.view': 'all', 'people.manage': 'all', 'roles.manage': 'all' }

describe('changing access', () => {
  it('gives role, extras, managed people and projects in one go, and the next request is judged by it', async () => {
    const person = await account('member')
    const client = await signedIn(app, person.email)
    const { project, person: other } = await make.workplace()
    const second = await make.project({ clientId: project.clientId })
    for (const { id } of [project, second]) await make.projectMember({ projectId: id, personId: person.id })
    expect(summary(await client.get('/people'))).toEqual([403, 'forbidden'])
    const saved = await change(person.id, {
      roleId: roleIds.manager, extras: ['billable.view', 'invoices.manage'], managedPersonIds: [other.id], managedProjectIds: [project.id],
    })
    expect(summary(saved)).toEqual(ok)
    expect(saved.body).toMatchObject({
      roleId: roleIds.manager, extras: ['billable.view', 'invoices.manage'], managedPeople: [{ id: other.id, active: true }], editable: 'all',
    })
    expect((await client.get('/people')).body).toMatchObject({ people: [{ id: other.id }] })
    expect(summary(await client.get(`/people/${other.id}`))).toEqual(ok)
    const unknown = await client.get('/people/999999')
    const hidden = await client.get(`/people/${adminId}`)
    expect([hidden.status, hidden.text]).toEqual([404, unknown.text])
    const info = (await client.get('/session')).body as SessionInfo
    expect(info.person?.permissions).toEqual(managerGrants(['billable.view', 'invoices.manage']))
    expect((await client.get('/account/access')).body).toEqual({
      role: { key: 'manager', name: 'Manager' }, administrator: false, grants: managerGrants(['billable.view', 'invoices.manage']),
      managedProjects: [project.name], managedPeople: [other.name],
    } satisfies AccessInfo)
    const [entry, ...more] = await logOf(person.id)
    expect(more).toEqual([])
    expect(entry).toMatchObject({
      actorId: adminId, changes: {
        role: ['Member', 'Manager'], extras: [[], ['billable.view', 'invoices.manage']], managedPeople: [[], [other.name]], managedProjects: [[], [project.name]],
      },
    })
    expect(entry?.createdAt).toBeInstanceOf(Date)
    // Saving what is there already notes nothing.
    expect(summary(await change(person.id, {}))).toEqual(ok)
    expect(await logOf(person.id)).toHaveLength(1)

    // Off again: gone at the next request. What is managed is kept, without effect.
    expect(summary(await change(person.id, { roleId: roleIds.member, extras: [] }))).toEqual(ok)
    expect(summary(await client.get('/people'))).toEqual([403, 'forbidden'])
    expect(await database.db.select().from(personExtras).where(eq(personExtras.personId, person.id))).toEqual([])
    expect((await client.get('/account/access')).body).toMatchObject({ grants: {}, managedProjects: [project.name], managedPeople: [other.name] })
    expect((await logOf(person.id))[1]?.changes).toEqual({ role: ['Manager', 'Member'], extras: [['billable.view', 'invoices.manage'], []] })
  })

  it('tells the web app with each answer that access changed, also with a refusal', async () => {
    const person = await account('manager')
    const client = await signedIn(app, person.email)
    const own = async () => ((await client.get('/session')).body as SessionInfo).person?.access
    const before = await own()
    expect((await client.get('/people')).headers['x-access']).toBe(before)
    await change(person.id, { extras: ['projects.create'] })
    const after = await own()
    expect(after).not.toBe(before)
    expect((await client.get('/people')).headers['x-access']).toBe(after)
    const other = await make.person()
    await change(person.id, { managedPersonIds: [other.id] })
    expect((await client.get('/people')).headers['x-access']).toBe(await own())
    expect(await own()).not.toBe(after)
    await change(person.id, { roleId: roleIds.member, extras: [] })
    const refused = await client.get('/people')
    expect([refused.status, refused.headers['x-access']]).toEqual([403, await own()])
    const info = (await client.get('/session')).body as SessionInfo
    expect(JSON.stringify(info)).not.toContain(other.name)
  })

  it('is refused when stale, keeps the other change, and tells so', async () => {
    const person = await make.person()
    const first = inputOf(await read(person.id))
    expect(summary(await change(person.id, { roleId: roleIds.manager }))).toEqual(ok)
    expect(summary(await office.put(`/people/${person.id}/access`, { ...first, managedPersonIds: [adminId] }))).toEqual([409, 'stale'])
    expect(await rowOf(person.id)).toMatchObject({ roleId: roleIds.manager })
    // Also when the project list changed from elsewhere.
    const next = inputOf(await read(person.id))
    const { project } = await make.workplace()
    await make.projectMember({ projectId: project.id, personId: person.id })
    expect(summary(await office.put(`/people/${person.id}/access`, next))).toEqual([409, 'stale'])
  })

  it('refuses what cannot be', async () => {
    const person = await make.person()
    const [archived, { project }] = [await make.person({ status: 'archived' }), await make.workplace()]
    const before = await accessOf(person.id)
    const bad = [
      { roleId: 999_999 }, { roleId: 'x' as never }, { extras: ['billable.view'] as never }, { roleId: roleIds.manager, extras: ['invoices.manage'] as never },
      { roleId: roleIds.manager, extras: ['people.manage'] as never }, { roleId: roleIds.manager, extras: ['time.fly'] as never },
      { managedPersonIds: [person.id] }, { managedPersonIds: [archived.id] }, { managedPersonIds: [999_999] },
      { managedProjectIds: [project.id] }, { managedProjectIds: [999_999] }, { state: 7 as never },
    ]
    for (const more of bad) {
      expect(summary(await change(person.id, more)), JSON.stringify(more)).toEqual([400, 'invalid_input'])
    }
    expect(await accessOf(person.id)).toBe(before)
    expect((await office.put('/people/999999/access', inputOf(await read(person.id)))).status).toBe(404)
    expect((await office.get('/people/999999/access')).status).toBe(404)
    for (const status of ['archived', 'pending'] as const) {
      const other = await make.person({ status })
      expect(await read(other.id)).toMatchObject({ editable: 'none' })
      expect(summary(await change(other.id, { roleId: roleIds.manager }))).toEqual([409, 'not_active'])
    }
  })

  it('keeps managed people who were archived since, and lets them go', async () => {
    const [lead, member] = [await account('manager'), await make.person()]
    await change(lead.id, { managedPersonIds: [member.id] })
    await database.db.update(people).set({ status: 'archived' }).where(eq(people.id, member.id))
    expect((await read(lead.id)).managedPeople).toEqual([{ id: member.id, name: member.name, active: false }])
    expect(summary(await change(lead.id, { extras: ['cost.view'] }))).toEqual(ok)
    expect(summary(await change(lead.id, { managedPersonIds: [] }))).toEqual(ok)
    expect((await read(lead.id)).managedPeople).toEqual([])
  })
})

describe('nobody raises their own access', () => {
  it('role, extras, managed people and manager flag of oneself are refused', async () => {
    const person = await account({ ...everything() })
    const client = await signedIn(app, person.email)
    const { project, person: other } = await make.workplace()
    await make.projectMember({ projectId: project.id, personId: person.id })
    const before = await accessOf(person.id)
    for (const more of [
      { roleId: roleIds.administrator }, { roleId: roleIds.manager, extras: ['cost.view'] as never }, { roleId: roleIds.member },
      { managedPersonIds: [other.id] }, { managedProjectIds: [project.id] }, {},
    ]) {
      expect(summary(await change(person.id, more, client)), JSON.stringify(more)).toEqual([403, 'own_access'])
    }
    expect(await accessOf(person.id)).toBe(before)
    expect(await read(person.id, client)).toMatchObject({ editable: 'none', reason: 'You cannot change your own access.' })
  })

  it('an administrator may set their own manager flag, and nothing else', async () => {
    const { project, person: other } = await make.workplace()
    await make.projectMember({ projectId: project.id, personId: adminId })
    expect(await read(adminId)).toMatchObject({ editable: 'flags', reason: 'You cannot change your own access.' })
    expect(summary(await change(adminId, { managedProjectIds: [project.id] }))).toEqual(ok)
    expect((await read(adminId)).projects).toMatchObject([{ id: project.id, isManager: true }])
    const before = await accessOf(adminId)
    for (const more of [{ roleId: roleIds.member }, { managedPersonIds: [other.id] }, { managedPersonIds: [other.id], managedProjectIds: [] }]) {
      expect(summary(await change(adminId, more))).toEqual([403, 'own_access'])
    }
    expect(await accessOf(adminId)).toBe(before)
    expect(summary(await change(adminId, { managedProjectIds: [] }))).toEqual(ok)
  })

  it('HR cannot give what it lacks, change who has more, or make an administrator', async () => {
    const person = await account(hr)
    const client = await signedIn(app, person.email)
    const [member, lead, admin, equal] = [await make.person(), await account('manager'), await account('administrator'), await account(hr)]
    const ownRole = (await rowOf(person.id))?.roleId ?? 0
    const tries: [number, object][] = [
      [person.id, { roleId: roleIds.administrator }], [member.id, { roleId: roleIds.manager }], [member.id, { roleId: roleIds.administrator }],
      [lead.id, { roleId: roleIds.member }], [lead.id, { extras: ['cost.view'] }], [lead.id, { managedPersonIds: [member.id] }],
      [admin.id, { roleId: roleIds.member }],
    ]
    for (const [id, more] of tries) {
      const before = await accessOf(id)
      const response = await change(id, more, client)
      expect(response.status, JSON.stringify(more)).toBe(403)
      expect(await accessOf(id)).toBe(before)
      expect(await read(id, client)).toMatchObject(id === member.id ? { editable: 'all' } : { editable: 'none' })
    }
    // What it has itself it may give and take.
    expect(summary(await change(member.id, { roleId: ownRole }, client))).toEqual(ok)
    expect(summary(await change(equal.id, { roleId: roleIds.member }, client))).toEqual(ok)
    const options = (await read(member.id, client)).roles
    expect(options.filter(({ refusal }) => refusal === null).map(({ id }) => id)).toEqual(expect.arrayContaining([roleIds.member, ownRole]))
    expect(options.find(({ id }) => id === roleIds.administrator)?.refusal).toContain('administrator')
    expect(options.find(({ id }) => id === roleIds.manager)?.refusal).toBeTruthy()
  })

  it('a permission can only be given at a level one has', async () => {
    const person = await account({ ...hr, ...managerGrants(), 'people.view': 'all', 'cost.view': 'managed' })
    const client = await signedIn(app, person.email)
    const { project, person: target } = await make.workplace()
    const [managed, all] = [await make.role({ 'cost.view': 'managed' }), await make.role({ 'cost.view': 'all' })]
    expect((await change(target.id, { roleId: all.id }, client)).status).toBe(403)
    expect(summary(await change(target.id, { roleId: managed.id }, client))).toEqual(ok)
    // Letting them manage a project takes having the permission there.
    const memberOf = (personId: number) => make.projectMember({ projectId: project.id, personId })
    await memberOf(target.id)
    const before = await accessOf(target.id)
    expect(summary(await change(target.id, { managedProjectIds: [project.id] }, client))).toEqual([403, 'cannot_grant'])
    expect(await accessOf(target.id)).toBe(before)
    const own = await memberOf(person.id)
    await database.db.update(projectMembers).set({ isManager: true }).where(eq(projectMembers.id, own.id))
    expect(summary(await change(target.id, { managedProjectIds: [project.id] }, client))).toEqual(ok)
    const someone = await make.person()
    expect(summary(await change(target.id, { managedPersonIds: [someone.id] }, client))).toEqual([403, 'cannot_grant'])
    await make.manages(person.id, someone.id)
    expect(summary(await change(target.id, { managedPersonIds: [someone.id] }, client))).toEqual(ok)
    await database.db.delete(personManagers).where(eq(personManagers.managerId, person.id))
    expect(summary(await change(target.id, { managedPersonIds: [] }, client))).toEqual([403, 'cannot_grant'])
  })

  it('only administrators give and take the Administrator role, also against every permission at all', async () => {
    const person = await account(everything())
    const client = await signedIn(app, person.email)
    const [member, admin] = [await make.person(), await account('administrator')]
    expect(summary(await change(member.id, { roleId: roleIds.administrator }, client))).toEqual([403, 'cannot_grant'])
    expect(summary(await change(admin.id, { roleId: roleIds.member }, client))).toEqual([403, 'cannot_grant'])
    expect(await rowOf(admin.id)).toMatchObject({ roleId: roleIds.administrator })
    expect(summary(await change(member.id, { roleId: roleIds.manager, extras: ['cost.view'] }, client))).toEqual(ok)
    expect(summary(await change(member.id, { roleId: roleIds.administrator, extras: [] }))).toEqual(ok)
    expect(summary(await change(member.id, { roleId: roleIds.member }))).toEqual(ok)
  })
})

describe('coming back to a project', () => {
  async function setUp() {
    const lead = await account('manager')
    const { project, client } = await make.workplace()
    await make.projectMember({ projectId: project.id, personId: lead.id, isManager: true, rate: 12_000 })
    const details = async (by = office) => (await by.get(`/people/${lead.id}`)).body as Required<PersonDetails>
    const assign = async (projectIds: number[], by = office) =>
      by.put(`/people/${lead.id}/assignments`, { clientIds: [client.id], projectIds, state: (await details()).state })
    const covered = async () => can(await loadActor(database.db, lead.id), 'projects.view', { type: 'project', projectId: project.id })
    await assign([])
    expect([await isProjectMember(database.db, lead.id, project.id), await covered()]).toEqual([false, false])
    return { lead, project, assign, covered }
  }
  const member = async (personId: number, projectId: number) =>
    (await database.db.select().from(projectMembers).where(and(eq(projectMembers.personId, personId), eq(projectMembers.projectId, projectId))))[0]

  it('restores the manager flag when the assigner could give it', async () => {
    const { lead, project, assign, covered } = await setUp()
    const saved = await assign([project.id])
    expect((saved.body as SavedAssignments).notManaged).toEqual([])
    expect(await member(lead.id, project.id)).toMatchObject({ isManager: true, removedAt: null, rate: 12_000 })
    expect(await covered()).toBe(true)
  })

  it('and otherwise not, which the answer and the log say', async () => {
    for (const grants of [{ 'people.view': 'all', 'people.manage': 'all' }, hr] as Grants[]) {
      const { lead, project, assign, covered } = await setUp()
      const client = await signedIn(app, (await account(grants)).email)
      const saved = await assign([project.id], client)
      expect(summary(saved)).toEqual(ok)
      expect((saved.body as SavedAssignments).notManaged).toEqual([project.name])
      expect(await member(lead.id, project.id)).toMatchObject({ isManager: false, removedAt: null, rate: 12_000 })
      expect(await covered()).toBe(false)
      const [entry] = await database.db.select().from(activityLog).where(and(eq(activityLog.subjectId, lead.id), eq(activityLog.action, 'assigned'))).orderBy(activityLog.id).offset(1)
      expect(entry?.changes).toMatchObject({ projectsAdded: [project.name], managerAgain: [], notManagerAgain: [project.name] })
      // Gone for good, also for an administrator who assigns later.
      await assign([])
      expect(((await assign([project.id])).body as SavedAssignments).notManaged).toEqual([])
      expect(await covered()).toBe(false)
    }
  })

  it('someone with the permissions everywhere may restore it', async () => {
    const { project, assign, covered } = await setUp()
    const client = await signedIn(app, (await account(everything())).email)
    expect(((await assign([project.id], client)).body as SavedAssignments).notManaged).toEqual([])
    expect(await covered()).toBe(true)
  })

  it('assigning oneself never restores it, except for administrators', async () => {
    for (const [role, restored] of [[everything(), false], ['administrator', true]] as const) {
      const person = await account(role)
      const client = await signedIn(app, person.email)
      const { project, client: company } = await make.workplace()
      const { id } = await make.projectMember({ projectId: project.id, personId: person.id, isManager: true })
      await database.db.update(projectMembers).set({ removedAt: new Date() }).where(eq(projectMembers.id, id))
      const { state } = (await client.get(`/people/${person.id}`)).body as Required<PersonDetails>
      const saved = await client.put(`/people/${person.id}/assignments`, { clientIds: [company.id], projectIds: [project.id], state })
      expect((saved.body as SavedAssignments).notManaged).toEqual(restored ? [] : [project.name])
      expect((await member(person.id, project.id))?.isManager).toBe(restored)
    }
  })

  it('setting the flag from elsewhere follows the same rule', async () => {
    const { lead, project, assign, covered } = await setUp()
    await assign([project.id])
    await database.db.update(projectMembers).set({ isManager: false }).where(eq(projectMembers.personId, lead.id))
    const target = await readPersonAccess(database.db, lead.id)
    const helper = await loadActor(database.db, (await account(hr)).id)
    const admin = await loadActor(database.db, adminId)
    if (!target) throw new Error('No such person')
    expect(checkManagerFlag(helper, target, project.id)?.code).toBe('cannot_grant')
    await expect(runTransaction(database.db, (tx) => setManagerFlag(tx, helper, target, project.id, true))).rejects.toMatchObject({ status: 403 })
    const other = await make.project({ clientId: project.clientId })
    await expect(runTransaction(database.db, (tx) => setManagerFlag(tx, admin, target, other.id, true))).rejects.toMatchObject({ code: 'not_member' })
    expect(await covered()).toBe(false)
    expect(await runTransaction(database.db, (tx) => setManagerFlag(tx, admin, target, project.id, true))).toBe(true)
    expect(await runTransaction(database.db, (tx) => setManagerFlag(tx, admin, target, project.id, true))).toBe(false)
    expect(await covered()).toBe(true)
    await database.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, project.id))
    expect((await read(lead.id)).projects).toMatchObject([{ id: project.id, archived: true, isManager: true }])
  })
})

describe('the last administrator', () => {
  it('cannot be taken away: of two who remove each other at once, one succeeds', async () => {
    const separate = await createTestDatabase()
    const own = accounts(separate.db)
    const [a, b] = [await own('administrator'), await own('administrator')]
    const at = testApp({ db: separate.db })
    const [first, second] = [await signedIn(at, a.email), await signedIn(at, b.email)]
    const [seenA, seenB] = [await read(a.id, first), await read(b.id, first)]
    const member = seenA.roles.find(({ key }) => key === 'member')?.id ?? 0
    const answers = await Promise.all([
      first.put(`/people/${b.id}/access`, { ...inputOf(seenB), roleId: member }),
      second.put(`/people/${a.id}/access`, { ...inputOf(seenA), roleId: member }),
    ])
    expect(answers.map(summary).sort()).toEqual([ok, [403, 'forbidden']])
    const left = await separate.db.select().from(people).innerJoin(roles, eq(roles.id, people.roleId)).where(eq(roles.key, 'administrator'))
    expect(left).toHaveLength(1)
    await separate.close()
  })

  it('is the last one with a password: another one without does not count', async () => {
    const separate = await createTestDatabase()
    const { db } = separate
    const [able, without] = [await accounts(db)('administrator'), await accounts(db)('administrator')]
    const client = await signedIn(testApp({ db }), without.email)
    await db.delete(personCredentials).where(eq(personCredentials.personId, without.id))
    const guard = (id: number) => runTransaction(db, (tx) => keepAnAdministrator(tx, id))
    await expect(guard(able.id)).rejects.toMatchObject({ status: 409, code: 'last_administrator' })
    await expect(guard(without.id)).resolves.toBeUndefined()
    const seen = await read(able.id, client)
    const member = seen.roles.find(({ key }) => key === 'member')?.id ?? 0
    expect(summary(await client.put(`/people/${able.id}/access`, { ...inputOf(seen), roleId: member }))).toEqual([409, 'last_administrator'])
    const archived = await accounts(db)('administrator', { status: 'archived' })
    await expect(guard(able.id)).rejects.toMatchObject({ code: 'last_administrator' })
    await db.update(people).set({ status: 'active' }).where(eq(people.id, archived.id))
    await expect(guard(able.id)).resolves.toBeUndefined()
    await separate.close()
  })
})

it('someone who loses the permission while giving does not succeed afterwards', async () => {
  const person = await account('administrator')
  const client = await signedIn(app, person.email)
  const member = await make.person()
  const role = await make.role({ 'outbox.view': 'all' })
  const [own, target] = [inputOf(await read(person.id)), inputOf(await read(member.id))]
  // Both under way at once: whichever comes first, nothing is given after the role is gone.
  const [lost, given] = await Promise.all([
    office.put(`/people/${person.id}/access`, { ...own, roleId: roleIds.member }),
    client.put(`/people/${member.id}/access`, { ...target, roleId: role.id }),
  ])
  expect(summary(lost)).toEqual(ok)
  if (given.status === 200) {
    const [removed, gave] = [(await logOf(person.id))[0], (await logOf(member.id))[0]]
    expect(gave?.id).toBeLessThan(removed?.id ?? 0)
  } else {
    expect(summary(given)).toEqual([403, 'forbidden'])
    expect((await rowOf(member.id))?.roleId).toBe(roleIds.member)
  }
  expect(summary(await client.put(`/people/${member.id}/access`, { ...target, roleId: role.id }))).toEqual([403, 'forbidden'])
})
