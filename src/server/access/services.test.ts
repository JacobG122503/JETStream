// Services called directly, as if the check of the route had been forgotten.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Grants, PermissionKey } from '../../shared/permissions'
import { createContext } from '../app'
import { createInvoiceFromEntries, EntryLockedError, lockExpenseForEdit, lockTimeEntryForEdit, type Move } from '../billing'
import type { AppContext } from '../context'
import { type Database, runTransaction, updateVersioned } from '../db'
import { activityLog, expenses, invites, passwordResets, people, projectMembers, roles, timeEntries } from '../db/schema'
import { ApiError } from '../errors'
import { readAccount, removePhoto, savePhoto, saveProfile } from '../people/account'
import { readAccessOf, readOwnAccess, saveAccess } from '../people/access'
import { saveAssignments } from '../people/assignments'
import { createInvite, listInvites, renewInvite, revokeInvite } from '../people/invites'
import { listPeople, readOptions, readPerson } from '../people/people'
import { approveRequest, declineRequest, readRequests, switchSignUp } from '../people/requests'
import { createResetLink, listHelpRequests } from '../people/resets'
import { createRole, deleteRole, listRoles, readRole, updateRole } from '../people/roles'
import { accounts } from '../testing/apiClient'
import { type Make, makeRecords } from '../testing/records'
import { createTestDatabase } from '../testing/testDatabase'
import { type Actor, loadActor } from './actor'
import { systemActor } from './system'

let database: Database
let make: Make
let ctx: AppContext
beforeAll(async () => {
  database = await createTestDatabase()
  make = makeRecords(database.db)
  ctx = createContext({ db: database.db, basePath: '/' })
})
afterAll(() => database.close())

const problem = async (work: () => Promise<unknown>): Promise<unknown> => {
  try {
    await work()
    return null
  } catch (error) {
    if (error instanceof ApiError) return error.code
    return error instanceof EntryLockedError ? error.reason : (error as Error).name
  }
}

describe('services refuse by themselves', () => {
  type Service = (actor: Actor, ids: { person: number; role: number }) => Promise<unknown>
  const access = { roleId: 1, extras: [], permissions: null, managedPersonIds: [], managedProjectIds: [], state: '' }
  const services: Record<string, [PermissionKey, Service]> = {
    listPeople: ['people.view', (actor) => listPeople(ctx.db, actor, ctx.now())],
    readPerson: ['people.view', (actor, { person }) => readPerson(ctx.db, actor, person, ctx.now())],
    readOptions: ['people.manage', (actor) => readOptions(ctx.db, actor)],
    saveAssignments: ['people.manage', (actor, { person }) => saveAssignments(ctx.db, actor, { personId: person, clientIds: [], projectIds: [], state: '', now: ctx.now() })],
    createResetLink: ['people.manage', (actor, { person }) => createResetLink(ctx, actor, person)],
    listHelpRequests: ['people.manage', (actor) => listHelpRequests(ctx.db, actor)],
    readRequests: ['people.manage', (actor) => readRequests(ctx.db, actor)],
    approveRequest: ['people.manage', (actor, { person }) => approveRequest(ctx, actor, person, { roleId: 3, clientIds: [], projectIds: [] })],
    declineRequest: ['people.manage', (actor, { person }) => declineRequest(ctx, actor, person)],
    switchSignUp: ['people.manage', (actor) => switchSignUp(ctx, actor, false)],
    listInvites: ['people.manage', (actor) => listInvites(ctx.db, actor, ctx.now())],
    createInvite: ['people.manage', (actor) => createInvite(ctx, actor, { name: 'X', email: 'service@jet.example', roleId: 3, clientIds: [], projectIds: [] })],
    renewInvite: ['people.manage', (actor) => renewInvite(ctx, actor, 1)],
    revokeInvite: ['people.manage', (actor) => revokeInvite(ctx, actor, 1)],
    listRoles: ['roles.manage', (actor) => listRoles(ctx.db, actor)],
    readRole: ['roles.manage', (actor, { role }) => readRole(ctx.db, actor, role, ctx.now())],
    createRole: ['roles.manage', (actor) => createRole(ctx, actor, { name: 'From a service', description: '', grants: {} })],
    updateRole: ['roles.manage', (actor, { role }) => updateRole(ctx, actor, role, { name: 'Other', description: '', grants: {}, version: 1 })],
    deleteRole: ['roles.manage', (actor, { role }) => deleteRole(ctx, actor, role, { version: 1, replacementId: null })],
    readAccessOf: ['roles.manage', (actor, { person }) => readAccessOf(ctx.db, actor, person)],
    saveAccess: ['roles.manage', (actor, { person }) => saveAccess(ctx, actor, person, access)],
  }

  it.each(Object.entries(services))('%s', async (_name, [permission, service]) => {
    const ids = { person: (await make.person()).id, role: (await make.role()).id }
    const snapshot = async () =>
      JSON.stringify([
        await ctx.db.select().from(people).orderBy(people.id), await ctx.db.select().from(roles).orderBy(roles.id), await ctx.db.select().from(invites),
        await ctx.db.select().from(passwordResets), await ctx.db.select().from(activityLog),
      ])
    const member = await make.person()
    const archived = await make.person({ roleId: (await make.builtInRole('administrator')).id, status: 'archived' })
    // Everything but what it takes.
    const other: Grants = permission === 'people.view' ? { 'projects.view': 'all' } : { 'people.view': 'all', 'time.view': 'all' }
    const helper = await make.person({ roleId: (await make.role(other)).id })
    const before = await snapshot()
    for (const { id } of [member, archived, helper]) {
      expect(await problem(async () => service(await loadActor(ctx.db, id), ids))).toBe('forbidden')
    }
    expect(await snapshot()).toBe(before)
  })

  it('also when the actor was read before they lost access', async () => {
    const admin = await make.person({ roleId: (await make.builtInRole('administrator')).id })
    const before = await loadActor(ctx.db, admin.id)
    await updateVersioned(ctx.db, people, admin.id, 1, { roleId: (await make.builtInRole('member')).id })
    const target = await accounts(ctx.db)('member')
    const role = await make.role()
    expect(await problem(() => createResetLink(ctx, before, target.id))).toBe('forbidden')
    expect(await problem(() => createRole(ctx, before, { name: 'Too late', description: '', grants: {} }))).toBe('forbidden')
    expect(await problem(() => updateRole(ctx, before, role.id, { name: 'Too late', description: '', grants: {}, version: 1 }))).toBe('forbidden')
    expect(await problem(() => saveAccess(ctx, before, target.id, access))).toBe('forbidden')
    expect(await problem(() => switchSignUp(ctx, before, false))).toBe('forbidden')
  })

  it('for one\'s own account: only active people, and only their own', async () => {
    const [person, other] = [await make.person({ name: 'Own' }), await make.person({ status: 'archived' })]
    const actor = await loadActor(ctx.db, person.id)
    expect(await readAccount(ctx.db, actor)).toMatchObject({ name: 'Own' })
    expect(await readOwnAccess(ctx.db, actor)).toEqual({ role: { key: 'member', name: 'Member' }, administrator: false, grants: {}, managedProjects: [], managedPeople: [] })
    for (const gone of [await loadActor(ctx.db, other.id), systemActor('tests')]) {
      expect(await problem(() => readAccount(ctx.db, gone))).toBe('forbidden')
      expect(await problem(() => readOwnAccess(ctx.db, gone))).toBe('forbidden')
      expect(await problem(() => saveProfile(ctx.db, gone, { name: 'X', timeZone: 'UTC', version: 1 }))).toBe('forbidden')
      expect(await problem(() => removePhoto(ctx.db, gone))).toBe('forbidden')
      expect(await problem(() => savePhoto(ctx.db, gone, Buffer.from('x')))).toBe('forbidden')
    }
  })

  it('but let people with the permission at managed see the people they manage', async () => {
    const lead = await make.person({ roleId: (await make.builtInRole('manager')).id })
    const [mine, other] = [await make.person(), await make.person()]
    await make.manages(lead.id, mine.id)
    const actor = await loadActor(ctx.db, lead.id)
    const listed = await listPeople(ctx.db, actor, ctx.now())
    expect(listed.map(({ id }) => id)).toEqual([mine.id])
    expect(listed[0]).not.toHaveProperty('signIn')
    const details = await readPerson(ctx.db, actor, mine.id, ctx.now())
    expect(Object.keys(details).sort()).toEqual(['email', 'id', 'name', 'photoId', 'role', 'status', 'timeZone'])
    for (const id of [other.id, lead.id, 999_999]) expect(await problem(() => readPerson(ctx.db, actor, id, ctx.now()))).toBe('NotFoundError')
  })
})

describe('changing time and expenses', () => {
  /** The lead manages P1 and A; B has an entry and an expense on P1 and P2. */
  async function setUp(...extras: PermissionKey[]) {
    const lead = await make.person({ roleId: (await make.builtInRole('manager')).id })
    if (extras.length > 0) await make.extras(lead.id, ...extras)
    const at = await make.workplace()
    const p2 = await make.project({ clientId: at.client.id })
    await make.projectTask({ projectId: p2.id, taskId: at.task.id })
    const a = await make.person()
    await make.projectMember({ projectId: at.project.id, personId: lead.id, isManager: true })
    await make.manages(lead.id, a.id)
    const category = await make.category()
    const on = async (projectId: number, personId = at.person.id) => ({
      entry: await make.timeEntry({ personId, projectId, taskId: at.task.id }),
      expense: await make.expense({ personId, projectId, categoryId: category.id }),
    })
    return { ...at, lead, a, p1: at.project, p2, b: at.person, b1: await on(at.project.id), b2: await on(p2.id), on }
  }
  type Both = Awaited<ReturnType<Awaited<ReturnType<typeof setUp>>['on']>>

  /** Edits the entry and the expense, as 009 and 011 will. Both must end the same. */
  async function edit(personId: number | null, { entry, expense }: Both, move: Move = {}, version = 1) {
    const actor = personId === null ? systemActor('tests') : await loadActor(ctx.db, personId)
    const time = await problem(() =>
      runTransaction(ctx.db, async (tx) => {
        await lockTimeEntryForEdit(tx, actor, entry.id, version, move)
        await updateVersioned(tx, timeEntries, entry.id, version, { notes: 'edited', ...move })
      }),
    )
    const cost = await problem(() =>
      runTransaction(ctx.db, async (tx) => {
        await lockExpenseForEdit(tx, actor, expense.id, version, move)
        await updateVersioned(tx, expenses, expense.id, version, { notes: 'edited', ...move })
      }),
    )
    expect(cost).toBe(time)
    const unchanged = async () => {
      const row = (await ctx.db.select().from(timeEntries)).find(({ id }) => id === entry.id)
      const other = (await ctx.db.select().from(expenses)).find(({ id }) => id === expense.id)
      return [row?.notes, row?.projectId, row?.personId, other?.notes, other?.projectId, other?.personId].join() === ['', entry.projectId, entry.personId, '', expense.projectId, expense.personId].join()
    }
    if (time !== null) expect(await unchanged()).toBe(true)
    return time
  }

  it('is forbidden where it may only be seen, and not found where it may not', async () => {
    const { lead, b, b1, b2, a } = await setUp()
    expect(await edit(lead.id, b1)).toBe('forbidden')
    expect(await edit(lead.id, b2)).toBe('NotFoundError')
    expect(await edit(a.id, b1)).toBe('NotFoundError')
    expect(await edit(b.id, b1)).toBeNull()
  })

  it('is allowed where the permission covers it, and nowhere else', async () => {
    const { lead, b1, b2, on, a, p2 } = await setUp('time.edit')
    expect(await edit(lead.id, b1)).toBeNull()
    expect(await edit(lead.id, b2)).toBe('NotFoundError')
    expect(await edit(lead.id, await on(p2.id, a.id))).toBeNull()
  })

  it('that moves a record must be allowed where it is and where it goes', async () => {
    const { lead, b, b1, p1, p2, a, on } = await setUp('time.edit')
    expect(await edit(lead.id, b1, { projectId: p2.id })).toBe('forbidden')
    expect(await edit(lead.id, b1, { projectId: 999_999 })).toBe('forbidden')
    expect(await edit(b.id, b1, { personId: a.id })).toBe('forbidden')
    // To someone they manage, it may go to any project; back it may not.
    expect(await edit(lead.id, b1, { personId: a.id })).toBeNull()
    const moved = { entry: { ...b1.entry, personId: a.id }, expense: { ...b1.expense, personId: a.id } }
    expect(await edit(lead.id, moved, { projectId: p2.id, personId: a.id }, 2)).toBeNull()
    const own = await on(p1.id, b.id)
    expect(await edit(b.id, own, { projectId: p2.id })).toBeNull()
  })

  it('tells what is missing before what is locked, and no permission goes past a lock', async () => {
    const { lead, b, b1, b2, on, p1, client } = await setUp('time.edit')
    const approve = async ({ entry, expense }: Both) => {
      await ctx.db.update(timeEntries).set({ status: 'approved', version: 1 }).where(eq(timeEntries.id, entry.id))
      await ctx.db.update(expenses).set({ status: 'approved', version: 1 }).where(eq(expenses.id, expense.id))
    }
    await approve(b1)
    await approve(b2)
    const admin = await make.person({ roleId: (await make.builtInRole('administrator')).id })
    expect(await edit(lead.id, b1)).toBe('approved')
    expect(await edit(admin.id, b1)).toBe('approved')
    expect(await edit(null, b1)).toBe('approved')
    expect(await edit(b.id, b1)).toBe('approved')
    expect(await edit(lead.id, b2)).toBe('NotFoundError')
    expect(await edit(lead.id, await on(p1.id), {}, 7)).toBe('StaleError')
    const billed = await on(p1.id)
    await createInvoiceFromEntries(
      ctx.db, { clientId: client.id, createdBy: admin.id, currency: 'USD', issuedOn: '2026-04-01', dueOn: '2026-05-01' },
      { timeEntries: [{ id: billed.entry.id, version: 1 }], expenses: [{ id: billed.expense.id, version: 1 }] },
    )
    expect(await edit(lead.id, billed, {}, 1)).toBe('invoiced')
    expect(await edit(admin.id, billed, {}, 7)).toBe('invoiced')
    await ctx.db.delete(projectMembers).where(eq(projectMembers.personId, lead.id))
    expect(await edit(lead.id, billed, {}, 1)).toBe('NotFoundError')
  })
})
