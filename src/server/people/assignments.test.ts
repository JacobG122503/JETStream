import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveBillableRate } from '../../shared/calc'
import type { PersonDetails as Details } from '../../shared/api'
import type { Database } from '../db'
import { activityLog, clients, people, personClients, projectMembers, projects, timeEntries } from '../db/schema'
import { accounts, type Browser, signedIn, testApp } from '../testing/apiClient'
import { type Make, makeRecords } from '../testing/records'
import { createTestDatabase } from '../testing/testDatabase'
import { isProjectMember } from './membership'

/** As those who manage people get them. */
type PersonDetails = Required<Details>

let database: Database
let make: Make
let office: Browser
let adminId: number
beforeAll(async () => {
  database = await createTestDatabase()
  make = makeRecords(database.db)
  const admin = await accounts(database.db)('administrator')
  adminId = admin.id
  office = await signedIn(testApp({ db: database.db }), admin.email)
})
afterAll(() => database.close())

const read = async (id: number) => (await office.get(`/people/${id}`)).body as PersonDetails
const save = (id: number, clientIds: number[], projectIds: number[], state: string) =>
  office.put(`/people/${id}/assignments`, { clientIds, projectIds, state })
const summary = (response: { status: number; body: unknown }) => [
  response.status, (response.body as { error?: { code: string } }).error?.code,
]
const assigned = ({ clients: list }: PersonDetails) => ({
  clients: list.filter((client) => client.assigned).map(({ id }) => id),
  projects: list.flatMap((client) => client.projects).filter((project) => project.assigned).map(({ id }) => id),
})

async function setUp() {
  const person = await make.person()
  const client = await make.client()
  const [one, two] = [await make.project({ clientId: client.id }), await make.project({ clientId: client.id })]
  return { person, client, one, two, state: (await read(person.id)).state }
}

describe('assigning', () => {
  it('a client assigns no project, and a project assigns its client', async () => {
    const { person, client, one, state } = await setUp()
    const first = await save(person.id, [client.id], [], state)
    expect(assigned(first.body as PersonDetails)).toEqual({ clients: [client.id], projects: [] })
    expect(await isProjectMember(database.db, person.id, one.id)).toBe(false)
    const second = await save(person.id, [], [one.id], (first.body as PersonDetails).state)
    expect(assigned(second.body as PersonDetails)).toEqual({ clients: [client.id], projects: [one.id] })
    expect(await database.db.select().from(personClients).where(eq(personClients.personId, person.id))).toHaveLength(1)
    const log = await database.db.select().from(activityLog).where(eq(activityLog.subjectId, person.id))
    expect(log).toMatchObject([
      { action: 'assigned', actorId: adminId, changes: { clientsAdded: [client.name] } },
      { action: 'assigned', actorId: adminId, changes: { projectsAdded: [one.name], clientsAdded: [] } },
    ])
    // Saving what is there already changes nothing.
    await save(person.id, [client.id], [one.id], (second.body as PersonDetails).state)
    expect(await database.db.select().from(activityLog).where(eq(activityLog.subjectId, person.id))).toHaveLength(2)
  })

  it('is refused when someone else changed it, for people who are not active, and for what does not exist', async () => {
    const { person, client, one, two, state } = await setUp()
    await save(person.id, [client.id], [one.id], state)
    expect(summary(await save(person.id, [client.id], [two.id], state))).toEqual([409, 'stale'])
    // Also when it was changed from the project's side.
    const before = (await read(person.id)).state
    await make.projectMember({ projectId: two.id, personId: person.id })
    expect(summary(await save(person.id, [], [], before))).toEqual([409, 'stale'])
    expect(assigned(await read(person.id)).projects).toEqual([one.id, two.id])
    const { state: now } = await read(person.id)
    expect(summary(await save(person.id, [999_999], [], now))).toEqual([400, 'invalid_input'])
    expect(summary(await save(person.id, [], [999_999], now))).toEqual([400, 'invalid_input'])
    expect(summary(await save(999_999, [], [], now))).toEqual([404, 'not_found'])
    for (const status of ['archived', 'pending'] as const) {
      const other = await make.person({ status })
      expect(summary(await save(other.id, [client.id], [], (await read(other.id)).state))).toEqual([409, 'not_active'])
    }
  })

  it('is done by one of two at the same time', async () => {
    const { person, client, one, two, state } = await setUp()
    const answers = await Promise.all([save(person.id, [client.id], [one.id], state), save(person.id, [client.id], [two.id], state)])
    expect(answers.map(({ status }) => status).sort()).toEqual([200, 409])
    expect(assigned(await read(person.id)).projects).toHaveLength(1)
  })

  it('does not offer what is archived, and leaves assignments to it', async () => {
    const { person, client, one, two, state } = await setUp()
    await save(person.id, [client.id], [one.id], state)
    const archivedAt = new Date()
    await database.db.update(projects).set({ archivedAt }).where(eq(projects.id, one.id))
    const page = await read(person.id)
    const shown = page.clients.find(({ id }) => id === client.id)
    expect(shown?.projects).toMatchObject([{ id: one.id, archived: true, assigned: true }, { id: two.id, archived: false, assigned: false }])
    // Left out or not, it stays.
    const kept = await save(person.id, [client.id], [two.id], page.state)
    expect(assigned(kept.body as PersonDetails).projects.sort()).toEqual([one.id, two.id].sort())
    const other = await make.person()
    const fresh = await read(other.id)
    expect(fresh.clients.find(({ id }) => id === client.id)?.projects.map(({ id }) => id)).toEqual([two.id])
    expect(summary(await save(other.id, [], [one.id], fresh.state))).toEqual([409, 'stale'])
    await database.db.update(clients).set({ archivedAt }).where(eq(clients.id, client.id))
    expect((await read(other.id)).clients.map(({ id }) => id)).not.toContain(client.id)
    const readOnly = await read(person.id)
    expect(readOnly.clients.find(({ id }) => id === client.id)).toMatchObject({ archived: true, assigned: true })
    const untouched = await save(person.id, [], [], readOnly.state)
    expect(assigned(untouched.body as PersonDetails)).toMatchObject({ clients: [client.id] })
    expect(await isProjectMember(database.db, person.id, two.id)).toBe(true)
  })

  it('removing a client removes its projects, archived ones too, and no other', async () => {
    const { person, client, one, two, state } = await setUp()
    const elsewhere = await make.workplace()
    const saved = await save(person.id, [], [one.id, two.id, elsewhere.project.id], state)
    await database.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, two.id))
    const after = await save(person.id, [], [elsewhere.project.id], (saved.body as PersonDetails).state)
    expect(assigned(after.body as PersonDetails)).toEqual({ clients: [elsewhere.client.id], projects: [elsewhere.project.id] })
    expect(await isProjectMember(database.db, person.id, two.id)).toBe(false)
    expect(client.id).not.toBe(elsewhere.client.id)
  })
})

it('keeps rate, manager flag and time of a removed assignment, and restores it', async () => {
  const { person, project, client, place } = await make.workplace()
  await database.db.update(projects).set({ rateMethod: 'person' }).where(eq(projects.id, project.id))
  await make.projectMember({ projectId: project.id, personId: person.id, rate: 15_000, isManager: true })
  const entry = await make.timeEntry(place)
  const member = async () => {
    const own = and(eq(projectMembers.projectId, project.id), eq(projectMembers.personId, person.id))
    const [row] = await database.db.select().from(projectMembers).where(own)
    return row
  }
  const rate = async () =>
    resolveBillableRate({
      date: entry.spentOn,
      billable: entry.billable,
      project: { type: 'time_materials', rateMethod: 'person', rate: null, currency: 'USD' },
      task: { projectRate: null, defaultRate: null },
      person: { projectRate: (await member())?.rate ?? null, rates: [] },
      companyCurrency: 'USD',
    })
  expect(await rate()).toEqual({ kind: 'rate', rate: 15_000 })
  const removed = await save(person.id, [], [], (await read(person.id)).state)
  expect(removed.status).toBe(200)
  expect(await isProjectMember(database.db, person.id, project.id)).toBe(false)
  expect(await rate()).toEqual({ kind: 'rate', rate: 15_000 })
  expect(await member()).toMatchObject({ rate: 15_000, isManager: true })
  expect(await database.db.select().from(timeEntries).where(eq(timeEntries.personId, person.id))).toHaveLength(1)
  await save(person.id, [client.id], [project.id], (removed.body as PersonDetails).state)
  expect(await isProjectMember(database.db, person.id, project.id)).toBe(true)
  expect(await member()).toMatchObject({ rate: 15_000, isManager: true, removedAt: null })
  expect(await rate()).toEqual({ kind: 'rate', rate: 15_000 })
})

it('lists people with how they sign in', async () => {
  const account = accounts(database.db)
  const list = async () => ((await office.get('/people')).body as { people: { id: number; signIn: string; status: string }[] }).people
  const [withPassword, without] = [await account('manager'), await make.person({ status: 'archived' })]
  const rows = await list()
  expect(rows.find(({ id }) => id === withPassword.id)).toMatchObject({ signIn: 'password', status: 'active', role: 'Project Manager' })
  expect(rows.find(({ id }) => id === without.id)).toMatchObject({ signIn: 'none', status: 'archived' })
  expect(rows).toHaveLength(await database.db.$count(people))
  expect(JSON.stringify(rows)).not.toContain('scrypt')
})
