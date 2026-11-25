// Invites and reset links: who may make them, and what happens when their maker's access changes.
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { InviteRow, JoinRequests, NewLink, PeopleOptions, PersonAccessDetails, PersonDetails, RoleDetails } from '../../shared/api'
import { everything, type Grants, managerGrants } from '../../shared/permissions'
import type { Database } from '../db'
import { activityLog, helpRequests, invites, passwordResets, people, personExtras, projectMembers, roles, signInAttempts } from '../db/schema'
import { accounts, browser, type Browser, signedIn, testApp, testClock } from '../testing/apiClient'
import { type Make, makeRecords } from '../testing/records'
import { createTestDatabase } from '../testing/testDatabase'

let database: Database
let account: ReturnType<typeof accounts>
let make: Make
let app: ReturnType<typeof testApp>
let office: Browser
let roleIds: Record<string, number>
const clock = testClock()
beforeAll(async () => {
  database = await createTestDatabase()
  account = accounts(database.db)
  make = makeRecords(database.db)
  app = testApp({ db: database.db, now: clock.now })
  office = await signedIn(app, (await account('administrator')).email)
  roleIds = Object.fromEntries((await database.db.select().from(roles)).map(({ key, id }) => [key ?? '', id] as const))
})
afterAll(() => database.close())
beforeEach(() => database.db.delete(signInAttempts))

const summary = (response: { status: number; body: unknown }) => [
  response.status, (response.body as { error?: { code: string } }).error?.code,
]
const ok = [200, undefined]
const made = [201, undefined]
const gone = [410, 'link_invalid']
let counter = 0
const newEmail = () => `link${++counter}@client.example`
const hrAll: Grants = { 'people.view': 'all', 'people.manage': 'all', 'roles.manage': 'all' }
const scheduling: Grants = { 'schedule.view': 'all', 'schedule.edit': 'all' }
const tokenOf = (response: { body: unknown }) => (response.body as NewLink).link.split('#')[1]
const invite = (client: Browser, roleId: number | undefined, email = newEmail()) => client.post('/invites', { name: 'Ivy', email, roleId })
const reset = (client: Browser, id: number) => client.post(`/people/${id}/reset-link`)
const check = async (kind: 'invite' | 'reset-password', token: string | undefined) => summary(await browser(app).post(`/${kind}/check`, { token }))
const saveRole = async (id: number, grants: Grants) => {
  const role = (await office.get(`/roles/${id}`)).body as RoleDetails
  return summary(await office.put(`/roles/${id}`, { name: role.name, description: '', grants, version: role.version }))
}
const saveAccess = async (id: number, more: object) => {
  const now = (await office.get(`/people/${id}/access`)).body as PersonAccessDetails
  const current = {
    state: now.state, roleId: now.roleId, extras: now.extras, managedPersonIds: now.managedPeople.map((person) => person.id),
    managedProjectIds: now.projects.filter(({ isManager }) => isManager).map((project) => project.id),
  }
  return summary(await office.put(`/people/${id}/access`, { ...current, ...more }))
}
const rowOf = async (email: string) => ((await office.get('/invites')).body as { invites: InviteRow[] }).invites.find((row) => row.email === email)

describe('making links', () => {
  it('a reset link needs at least the access of the person', async () => {
    const helper = await account(hrAll)
    const client = await signedIn(app, helper.email)
    const [member, admin, lead, equal] = [await account('member'), await account('administrator'), await account('manager'), await account(hrAll)]
    for (const target of [admin, lead]) {
      expect(summary(await reset(client, target.id))).toEqual([403, 'outranked'])
      expect(await database.db.select().from(passwordResets).where(eq(passwordResets.personId, target.id))).toEqual([])
      expect((await client.get(`/people/${target.id}`)).body).toMatchObject({ accountRefusal: expect.stringContaining('at least the same access') as string })
    }
    for (const target of [member, equal]) {
      expect(summary(await reset(client, target.id))).toEqual(made)
      expect(((await client.get(`/people/${target.id}`)).body as PersonDetails).accountRefusal).toBeNull()
    }
    // Every permission at all is still not an administrator.
    const strong = await signedIn(app, (await account(everything())).email)
    expect(summary(await reset(strong, admin.id))).toEqual([403, 'outranked'])
    expect(summary(await reset(strong, lead.id))).toEqual(made)
    expect((await reset(strong, 999_999)).status).toBe(404)
  })

  it('inviting an existing person without a password needs at least their access, and no help request closes otherwise', async () => {
    const client = await signedIn(app, (await account(hrAll)).email)
    const lead = await make.person({ roleId: roleIds.manager })
    await database.db.insert(helpRequests).values({ personId: lead.id })
    for (const role of [roleIds.member, roleIds.manager]) expect((await invite(client, role, lead.email)).status).toBe(403)
    expect(await database.db.select().from(invites).where(eq(invites.email, lead.email))).toEqual([])
    const [help] = await database.db.select().from(helpRequests).where(eq(helpRequests.personId, lead.id))
    expect(help?.closedAt).toBeNull()
    expect(summary(await invite(client, roleIds.member, (await make.person()).email))).toEqual(made)
  })

  it('a role other than Member needs roles.manage and everything in it', async () => {
    const onlyPeople = await signedIn(app, (await account({ 'people.view': 'all', 'people.manage': 'all' })).email)
    const helper = await signedIn(app, (await account(hrAll)).email)
    const strong = await signedIn(app, (await account(everything())).email)
    const [small, same] = [await make.role({ 'people.view': 'managed' }), await make.role(hrAll)]
    const given = async (client: Browser) => {
      const answers: [number, number][] = []
      for (const role of [roleIds.member, small.id, same.id, roleIds.manager, roleIds.administrator]) {
        const invited = await invite(client, role)
        const pending = await account('member', { status: 'pending' })
        const approved = await client.post(`/requests/${pending.id}/approve`, { roleId: role })
        answers.push([invited.status, approved.status])
        const [row] = await database.db.select().from(people).where(eq(people.id, pending.id))
        expect(row?.status).toBe(approved.status === 200 ? 'active' : 'pending')
      }
      const { body } = (await client.get('/people/options')) as { body: PeopleOptions }
      const allowed = (id: number | undefined) => body.roles.find((role) => role.id === id)?.allowed
      expect([roleIds.member, small.id, same.id, roleIds.manager, roleIds.administrator].map(allowed)).toEqual(answers.map(([status]) => status === 201))
      return answers
    }
    const [yes, no] = [[201, 200], [403, 403]]
    expect(await given(onlyPeople)).toEqual([yes, no, no, no, no])
    expect(await given(helper)).toEqual([yes, yes, yes, no, no])
    expect(await given(strong)).toEqual([yes, yes, yes, yes, no])
    expect(await given(office)).toEqual([yes, yes, yes, yes, yes])
  })

  it('someone who manages people without being an administrator can do all of 004\'s work', async () => {
    const helper = await account({ 'people.view': 'all', 'people.manage': 'all' })
    const client = await signedIn(app, helper.email)
    const { client: company, project } = await make.workplace()
    await browser(app).post('/sign-up', { name: 'Noor', email: newEmail(), password: 'a good password', timeZone: 'UTC' })
    const { requests } = (await client.get('/requests')).body as JoinRequests
    const [first] = requests
    expect(summary(await client.post(`/requests/${first?.id}/approve`, { roleId: roleIds.member, clientIds: [company.id], projectIds: [project.id] }))).toEqual(ok)
    const row = ((await client.get('/people')).body as { people: PersonDetails[] }).people.find(({ id }) => id === first?.id)
    expect(row).toMatchObject({ role: 'Member', signIn: 'password' })
    const details = (await client.get(`/people/${first?.id}`)).body as Required<PersonDetails>
    expect(summary(await client.put(`/people/${first?.id}/assignments`, { clientIds: [], projectIds: [], state: details.state }))).toEqual(ok)
    expect(summary(await reset(client, first?.id ?? 0))).toEqual(made)
    expect((await client.get('/help-requests')).status).toBe(200)
    expect(summary(await client.put('/requests/enabled', { enabled: true }))).toEqual(ok)
    const email = newEmail()
    const token = tokenOf(await invite(client, roleIds.member, email))
    expect(await check('invite', token)).toEqual(ok)
    const { id } = (await rowOf(email)) ?? { id: 0 }
    expect(summary(await client.post(`/invites/${id}/link`))).toEqual(made)
    expect(summary(await client.post(`/invites/${id}/revoke`))).toEqual(ok)
    // Roles and access are not part of it.
    expect((await client.get('/roles')).status).toBe(403)
    expect((await client.get(`/people/${first?.id}/access`)).status).toBe(403)
  })

  it('Manager is given without extras, also to someone who had some', async () => {
    const lead = await make.person({ roleId: roleIds.manager })
    await make.extras(lead.id, 'cost.view', 'billable.view')
    const token = tokenOf(await invite(office, roleIds.manager, lead.email))
    const accepted = await browser(app).post('/invite/accept', { token, name: 'Lead', password: 'a good password', timeZone: 'UTC' })
    expect(accepted.body).toMatchObject({ person: { permissions: managerGrants() } })
    expect(await database.db.select().from(personExtras).where(eq(personExtras.personId, lead.id))).toEqual([])
    const [entry] = await database.db.select().from(activityLog).where(and(eq(activityLog.subjectId, lead.id), eq(activityLog.action, 'invite_accepted')))
    expect(entry?.changes).toMatchObject({ role: ['Project Manager', 'Project Manager'], extras: [['billable.view', 'cost.view'], []] })
  })

  it('an accepted invite restores a manager flag only if its maker could give it', async () => {
    for (const [grants, restored] of [[everything(), true], [{ 'people.view': 'all', 'people.manage': 'all' }, false]] as [Grants, boolean][]) {
      const client = await signedIn(app, (await account(grants)).email)
      const { project, client: company } = await make.workplace()
      const person = await make.person()
      const { id } = await make.projectMember({ projectId: project.id, personId: person.id, isManager: true })
      await database.db.update(projectMembers).set({ removedAt: clock.now() }).where(eq(projectMembers.id, id))
      const invited = await client.post('/invites', { name: 'P', email: person.email, roleId: roleIds.member, clientIds: [company.id], projectIds: [project.id] })
      await browser(app).post('/invite/accept', { token: tokenOf(invited), name: 'P', password: 'a good password', timeZone: 'UTC' })
      const [member] = await database.db.select().from(projectMembers).where(eq(projectMembers.id, id))
      expect(member).toMatchObject({ isManager: restored, removedAt: null })
    }
  })
})

describe('using links', () => {
  it('a link is void while its target or role has more than its maker, and works again after', async () => {
    const scheduler = await make.role(scheduling)
    const helper = await account({ ...hrAll, ...scheduling })
    const client = await signedIn(app, helper.email)
    const email = newEmail()
    const token = tokenOf(await invite(client, scheduler.id, email))
    const holder = await account('member', { roleId: scheduler.id })
    const resetToken = tokenOf(await reset(client, holder.id))
    expect([await check('invite', token), await check('reset-password', resetToken)]).toEqual([ok, ok])
    expect(await saveRole(scheduler.id, { ...scheduling, 'cost.view': 'managed' })).toEqual(ok)
    expect([await check('invite', token), await check('reset-password', resetToken)]).toEqual([gone, gone])
    const used = await browser(app).post('/invite/accept', { token, name: 'X', password: 'a good password', timeZone: 'UTC' })
    expect(summary(used)).toEqual(gone)
    expect(summary(await browser(app).post('/reset-password/use', { token: resetToken, password: 'a good password' }))).toEqual(gone)
    expect(await rowOf(email)).toMatchObject({ status: 'void' })
    // The maker gaining something else does not end it.
    expect(await saveAccess(helper.id, { roleId: (await make.role({ ...hrAll, ...scheduling, 'outbox.view': 'all' })).id })).toEqual(ok)
    expect(await saveRole(scheduler.id, scheduling)).toEqual(ok)
    expect([await check('invite', token), await check('reset-password', resetToken)]).toEqual([ok, ok])
  })

  it('a link is void while its maker is not active', async () => {
    const admin = await account('administrator')
    const client = await signedIn(app, admin.email)
    const token = tokenOf(await invite(client, roleIds.member))
    await database.db.update(people).set({ status: 'archived' }).where(eq(people.id, admin.id))
    expect(await check('invite', token)).toEqual(gone)
  })

  it('an administrator who loses the role and gets it back: the links stay dead, and a new one works', async () => {
    const admin = await account('administrator')
    const client = await signedIn(app, admin.email)
    const email = newEmail()
    const member = await account('member')
    const token = tokenOf(await invite(client, roleIds.manager, email))
    const resetToken = tokenOf(await reset(client, member.id))
    expect([await check('invite', token), await check('reset-password', resetToken)]).toEqual([ok, ok])
    expect(await saveAccess(admin.id, { roleId: roleIds.member })).toEqual(ok)
    expect([await check('invite', token), await check('reset-password', resetToken)]).toEqual([gone, gone])
    expect(await rowOf(email)).toMatchObject({ status: 'void' })
    clock.forward(5)
    expect(await saveAccess(admin.id, { roleId: roleIds.administrator })).toEqual(ok)
    expect([await check('invite', token), await check('reset-password', resetToken)]).toEqual([gone, gone])
    expect(await rowOf(email)).toMatchObject({ status: 'void' })
    const { id } = (await rowOf(email)) ?? { id: 0 }
    const renewed = await client.post(`/invites/${id}/link`)
    expect(summary(renewed)).toEqual(made)
    expect(await rowOf(email)).toMatchObject({ status: 'open' })
    const accepted = await browser(app).post('/invite/accept', { token: tokenOf(renewed), name: 'X', password: 'a good password', timeZone: 'UTC' })
    expect(accepted.body).toMatchObject({ person: { role: { key: 'manager' } } })
    expect(await check('reset-password', tokenOf(await reset(client, member.id)))).toEqual(ok)
  })

  it.each([
    ['the content of their role', async (_id: number, roleId: number) => saveRole(roleId, { 'people.view': 'all' })],
    ['deleting their role', async (_id: number, roleId: number) => {
      const { version } = (await office.get(`/roles/${roleId}`)).body as RoleDetails
      return summary(await office.post(`/roles/${roleId}/delete`, { version, replacementId: roleIds.member }))
    }],
    ['another role', async (id: number) => saveAccess(id, { roleId: roleIds.manager })],
  ])('losing access by %s ends the links for good', async (_how, lose) => {
    const grants: Grants = { 'people.view': 'all', 'people.manage': 'all' }
    const helper = await account(grants)
    const [{ roleId } = { roleId: 0 }] = await database.db.select().from(people).where(eq(people.id, helper.id))
    const client = await signedIn(app, helper.email)
    const token = tokenOf(await invite(client, roleIds.member))
    const resetToken = tokenOf(await reset(client, (await account('member')).id))
    expect(await lose(helper.id, roleId)).toEqual(ok)
    const back = await make.role(grants)
    expect(await saveAccess(helper.id, { roleId: back.id })).toEqual(ok)
    expect([await check('invite', token), await check('reset-password', resetToken)]).toEqual([gone, gone])
  })

  it('losing something that was not needed keeps them', async () => {
    const helper = await account({ ...hrAll, ...scheduling })
    const client = await signedIn(app, helper.email)
    const [plain, withRole] = [tokenOf(await invite(client, roleIds.member)), tokenOf(await invite(client, (await make.role(scheduling)).id))]
    expect(await saveAccess(helper.id, { roleId: (await make.role(hrAll)).id })).toEqual(ok)
    expect([await check('invite', plain), await check('invite', withRole)]).toEqual([ok, gone])
    expect(await saveAccess(helper.id, { roleId: (await make.role({ ...hrAll, ...scheduling })).id })).toEqual(ok)
    expect([await check('invite', plain), await check('invite', withRole)]).toEqual([ok, gone])
  })

  it('a link made while its maker is losing access does not survive', async () => {
    const admin = await account('administrator')
    const client = await signedIn(app, admin.email)
    const member = await account('member')
    const now = (await office.get(`/people/${admin.id}/access`)).body as PersonAccessDetails
    const body = { state: now.state, roleId: roleIds.member, extras: [], managedPersonIds: [], managedProjectIds: [] }
    const [link, inviteLink, lost] = await Promise.all([reset(client, member.id), invite(client, roleIds.member), office.put(`/people/${admin.id}/access`, body)])
    expect(summary(lost)).toEqual(ok)
    if (link.status === 201) expect(await check('reset-password', tokenOf(link))).toEqual(gone)
    if (inviteLink.status === 201) expect(await check('invite', tokenOf(inviteLink))).toEqual(gone)
    expect(await database.db.select().from(passwordResets).where(eq(passwordResets.createdBy, admin.id)).then((rows) => rows.filter(({ revokedAt }) => revokedAt === null))).toEqual([])
  })
})
