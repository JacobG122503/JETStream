// Decisions and list filters, compared with sets worked out here from the rules in docs/permissions.md.
import { eq, type SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Grants, type Level, managerExtras, type PermissionKey, permissionCatalogue, permissionOf } from '../../shared/permissions'
import type { Database } from '../db'
import {
  assignments, clients, estimateLines, estimates, expenseReceipts, expenses, invoiceLines, invoices, people, personManagers,
  projectMembers, projects, timeEntries, timeOffRequests,
} from '../db/schema'
import { seedDemo } from '../demo'
import { type Make, makeRecords } from '../testing/records'
import { createTestDatabase } from '../testing/testDatabase'
import { type Actor, loadActor, SystemActor } from './actor'
import { can, holds, ownId, owns, type RecordFacts, type RecordType, requireAdministrator, requireRecord } from './decisions'
import { readFacts, readReceiptFacts } from './facts'
import { filterFor } from './filters'
import { systemActor } from './system'

const scoped = permissionCatalogue.filter(({ levels }) => levels.includes('managed')).map(({ key }) => key)
const everyScoped = (level: Level) => Object.fromEntries(scoped.map((key) => [key, level])) as Grants
const errorOf = (work: () => void): unknown => {
  try {
    work()
  } catch (error) {
    return error instanceof Error && 'code' in error ? error.code : (error as Error).name
  }
  return null
}

describe('on the demo data', () => {
  let database: Database
  let make: Make
  const actors: Record<string, number> = {}

  beforeAll(async () => {
    database = await createTestDatabase()
    const { db } = database
    await seedDemo(db, { today: '2026-03-04' })
    make = makeRecords(db)
    const byEmail = async (email: string) => (await db.select().from(people).where(eq(people.email, email)))[0]?.id ?? 0
    const manager = await make.builtInRole('manager')
    const lead = await byEmail('lead@jet.demo')
    const copyOfLead = async (values: Parameters<Make['person']>[0]) => {
      const person = await make.person(values)
      const led = await db.select().from(projectMembers).where(eq(projectMembers.personId, lead))
      for (const { projectId, isManager } of led) await make.projectMember({ projectId, personId: person.id, isManager })
      const team = await db.select().from(personManagers).where(eq(personManagers.managerId, lead))
      for (const { personId } of team) await make.manages(person.id, personId)
      return person.id
    }
    actors.administrator = await byEmail('admin@jet.demo')
    actors.lead = lead
    actors.member = await byEmail('employee@jet.demo')
    actors.bookkeeper = await byEmail('elena.marchetti@jet.example')
    actors.archived = await byEmail('lydia.farrow@jet.example')
    actors.manager = await copyOfLead({ roleId: manager.id })
    actors.managerWithExtras = await copyOfLead({ roleId: manager.id })
    await make.extras(actors.managerWithExtras, ...managerExtras)
    actors.managerOfNothing = (await make.person({ roleId: manager.id })).id
    await make.extras(actors.managerOfNothing, ...managerExtras)
    actors.customManaged = await copyOfLead({ roleId: (await make.role(everyScoped('managed'))).id })
    actors.customAll = await copyOfLead({ roleId: (await make.role(everyScoped('all'))).id })
    // Records that the seed has none of: made by a manager, and of no project.
    const [client] = await db.select().from(clients)
    const own = { clientId: client?.id ?? 0, createdBy: actors.managerWithExtras }
    const freeForm = await make.invoice(own)
    await make.invoice({ ...own, createdBy: actors.customManaged })
    const line = { position: 1, kind: 'manual' as const, quantity: 1000, unitPrice: 100, amount: 100 }
    await db.insert(invoiceLines).values({ ...line, invoiceId: freeForm.id })
    await db.insert(estimates).values({ ...own, number: 'TEST-E', currency: 'USD', issuedOn: '2026-03-01' })
    // Their own time, on a project they manage and on one they do not.
    const led = await db.select().from(projectMembers).where(eq(projectMembers.personId, actors.managerWithExtras))
    for (const { projectId } of [...led.filter(({ isManager }) => isManager), ...led.filter(({ isManager }) => !isManager)].slice(-3)) {
      const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.projectId, projectId))
      for (const personId of [actors.managerWithExtras, actors.customManaged]) {
        if (entry) await make.timeEntry({ personId, projectId, taskId: entry.taskId })
      }
    }
  })
  afterAll(() => database.close())

  /** Every record of a type, with its key and what the rules look at. */
  async function allRecords(type: RecordType): Promise<{ key: string; facts: RecordFacts }[]> {
    const { db } = database
    const lines = async (table: typeof invoiceLines | typeof estimateLines) =>
      (await db.select().from(table as typeof invoiceLines)) as { invoiceId?: number; estimateId?: number; projectId: number | null }[]
    const linked = (rows: { projectId: number | null }[]) => [
      ...new Set(rows.flatMap(({ projectId }) => (projectId === null ? [] : [projectId]))),
    ]
    switch (type) {
      case 'project':
        return (await db.select().from(projects)).map(({ id }) => ({ key: String(id), facts: { type, projectId: id } }))
      case 'client':
        return (await db.select().from(clients)).map(({ id }) => ({ key: String(id), facts: { type, clientId: id } }))
      case 'person':
        return (await db.select().from(people)).map(({ id }) => ({ key: String(id), facts: { type, personId: id } }))
      case 'timeEntry':
        return (await db.select().from(timeEntries)).map(({ id, personId, projectId }) => ({ key: String(id), facts: { type, personId, projectId } }))
      case 'expense':
        return (await db.select().from(expenses)).map(({ id, personId, projectId }) => ({ key: String(id), facts: { type, personId, projectId } }))
      case 'receipt': {
        const list = new Map((await db.select().from(expenses)).map((expense) => [expense.id, expense]))
        return (await db.select().from(expenseReceipts)).map(({ expenseId, fileId }) => {
          const { personId = 0, projectId = 0 } = list.get(expenseId) ?? {}
          return { key: `${expenseId}/${fileId}`, facts: { type, personId, projectId } }
        })
      }
      case 'invoice': {
        const all = await lines(invoiceLines)
        return (await db.select().from(invoices)).map(({ id, createdBy }) => ({
          key: String(id), facts: { type, createdBy, projectIds: linked(all.filter(({ invoiceId }) => invoiceId === id)) },
        }))
      }
      case 'estimate': {
        const all = await lines(estimateLines)
        return (await db.select().from(estimates)).map(({ id, createdBy, projectId }) => ({
          key: String(id), facts: { type, createdBy, projectIds: linked([{ projectId }, ...all.filter(({ estimateId }) => estimateId === id)]) },
        }))
      }
      case 'assignment':
        return (await db.select().from(assignments)).map(({ id, personId, projectId }) => ({ key: String(id), facts: { type, personId, projectId } }))
      case 'timeOffRequest':
        return (await db.select().from(timeOffRequests)).map(({ id, personId }) => ({ key: String(id), facts: { type, personId } }))
    }
  }

  /** The rules once more, from the tables alone. */
  async function expectedKeys(personId: number, permission: PermissionKey, records: { key: string; facts: RecordFacts }[]): Promise<string[]> {
    const { db } = database
    const level = expectedLevel(Object.entries(actors).find(([, id]) => id === personId)?.[0] ?? '', permission)
    if (level === undefined) return []
    if (level === 'all') return records.map(({ key }) => key)
    const memberships = await db.select().from(projectMembers)
    const led = memberships.filter((row) => row.personId === personId && row.isManager && row.removedAt === null).map(({ projectId }) => projectId)
    const team = (await db.select().from(personManagers)).filter(({ managerId }) => managerId === personId).map((row) => row.personId)
    const clientOf = new Map((await db.select().from(projects)).map(({ id, clientId }) => [id, clientId]))
    const covered = (facts: RecordFacts): boolean => {
      switch (facts.type) {
        case 'project': return led.includes(facts.projectId)
        case 'client': return led.some((projectId) => clientOf.get(projectId) === facts.clientId)
        case 'person': case 'timeOffRequest': return team.includes(facts.personId)
        case 'timeEntry': case 'expense': case 'receipt': case 'assignment':
          return led.includes(facts.projectId) || (facts.personId !== null && team.includes(facts.personId))
        case 'invoice': case 'estimate':
          return facts.projectIds.length > 0 ? facts.projectIds.every((id) => led.includes(id)) : facts.createdBy === personId
      }
    }
    const own = ({ facts }: { facts: RecordFacts }) => 'personId' in facts && facts.personId === personId
    const approval = permission === 'time.approve' || permission === 'timeoff.approve'
    return records.filter((record) => covered(record.facts) && !(approval && own(record))).map(({ key }) => key)
  }

  function expectedLevel(actor: string, permission: PermissionKey): Level | undefined {
    const { levels, manager } = permissionOf(permission)
    const bookkeeping = ['clients.view', 'time.view', 'billable.view', 'invoices.manage', 'payments.manage', 'expenses.reimburse']
    const own = levels.includes('managed') ? 'managed' : 'all'
    switch (actor) {
      case 'administrator': return 'all'
      case 'bookkeeper': return bookkeeping.includes(permission) ? 'all' : undefined
      case 'manager': return manager === 'yes' ? 'managed' : undefined
      case 'lead': return manager === 'yes' || ['time.approve', 'projects.create', 'billable.view'].includes(permission) ? own : undefined
      case 'managerWithExtras': case 'managerOfNothing': return manager === 'no' ? undefined : own
      case 'customManaged': return levels.includes('managed') ? 'managed' : undefined
      case 'customAll': return levels.includes('managed') ? 'all' : undefined
      default: return undefined
    }
  }

  const tables: Record<RecordType, PgTable> = {
    project: projects, client: clients, person: people, timeEntry: timeEntries, expense: expenses, receipt: expenseReceipts,
    invoice: invoices, estimate: estimates, assignment: assignments, timeOffRequest: timeOffRequests,
  }
  async function listKeys(type: RecordType, filter: SQL): Promise<string[]> {
    const { db } = database
    if (type === 'receipt') {
      const rows = await db.select({ receipt: expenseReceipts }).from(expenseReceipts).innerJoin(expenses, eq(expenses.id, expenseReceipts.expenseId)).where(filter)
      return rows.map(({ receipt }) => `${receipt.expenseId}/${receipt.fileId}`)
    }
    const rows = (await db.select().from(tables[type]).where(filter)) as { id: number }[]
    return rows.map(({ id }) => String(id))
  }

  it('has the permissions of each actor right', async () => {
    for (const [name, id] of Object.entries(actors)) {
      const actor = await loadActor(database.db, id)
      for (const { key } of permissionCatalogue) {
        expect([name, key, holds(actor, key), holds(actor, key, 'all')]).toEqual([
          name, key, expectedLevel(name, key) !== undefined, expectedLevel(name, key) === 'all',
        ])
      }
      expect([name, actor.administrator]).toEqual([name, name === 'administrator'])
    }
  })

  const cases: [RecordType, PermissionKey[]][] = [
    ['project', ['projects.view', 'projects.edit', 'billable.view', 'cost.view']],
    ['client', ['clients.view', 'clients.manage']],
    ['person', ['people.view', 'people.manage', 'cost.view']],
    ['timeEntry', ['time.view', 'time.edit', 'time.approve', 'time.unlock', 'billable.view']],
    ['expense', ['time.view', 'time.edit', 'time.approve', 'expenses.reimburse']],
    ['receipt', ['time.view']],
    ['invoice', ['invoices.manage', 'payments.manage']],
    ['estimate', ['estimates.manage']],
    ['assignment', ['schedule.view', 'schedule.edit']],
    ['timeOffRequest', ['timeoff.approve', 'timeoff.manage']],
  ]
  it.each(cases)('%s: decision and list agree with the rules on every record', { timeout: 60_000 }, async (type, permissions) => {
    const records = await allRecords(type)
    expect(records.length, 'records to judge').toBeGreaterThan(1)
    let partly = 0
    for (const [name, id] of Object.entries(actors)) {
      const actor = await loadActor(database.db, id)
      for (const permission of permissions) {
        const expected = (await expectedKeys(id, permission, records)).sort()
        const decided = records.filter(({ facts }) => can(actor, permission, facts)).map(({ key }) => key).sort()
        const listed = (await listKeys(type, filterFor(database.db, actor, permission, type))).sort()
        expect(decided, `${name}, ${permission}: decision`).toEqual(expected)
        expect(listed, `${name}, ${permission}: list`).toEqual(expected)
        if (expected.length > 0 && expected.length < records.length) partly++
        const withOwn = records.filter(({ facts }) => can(actor, permission, facts) || owns(actor, facts)).map(({ key }) => key).sort()
        expect((await listKeys(type, filterFor(database.db, actor, permission, type, { orOwner: true }))).sort(), `${name}, ${permission}: with own`).toEqual(withOwn)
      }
    }
    expect(partly, 'lists that are neither empty nor complete').toBeGreaterThan(0)
  })

  it('reads the facts of a record as they are', async () => {
    for (const [type] of cases) {
      for (const { key, facts } of (await allRecords(type)).slice(0, 40)) {
        const [first = 0, second = 0] = key.split('/').map(Number)
        const read = type === 'receipt' ? await readReceiptFacts(database.db, { expenseId: first, fileId: second }) : await readFacts(database.db, type, first)
        expect(read && normal(read), `${type} ${key}`).toEqual(normal(facts))
      }
      if (type !== 'receipt') expect(await readFacts(database.db, type, 999_999)).toBeUndefined()
    }
  })
  const normal = (facts: RecordFacts) => ('projectIds' in facts ? { ...facts, projectIds: [...facts.projectIds].sort() } : facts)

  it('puts the coverage into the query, so that pages and totals are right', async () => {
    const actor = await loadActor(database.db, actors.manager ?? 0)
    const filter = filterFor(database.db, actor, 'time.view', 'timeEntry')
    const total = await database.db.$count(timeEntries, filter)
    const page = await database.db.select().from(timeEntries).where(filter).orderBy(timeEntries.id).limit(25).offset(total - 10)
    expect(page).toHaveLength(10)
    expect(total).toBeLessThan(await database.db.$count(timeEntries))
  })
})

describe('edges', () => {
  let database: Database
  let make: Make
  beforeAll(async () => {
    database = await createTestDatabase()
    make = makeRecords(database.db)
  })
  afterAll(() => database.close())

  /** The lead manages P1 and A; A and B have time on P1 and P2. */
  async function setUp(...extras: PermissionKey[]) {
    const manager = await make.builtInRole('manager')
    const [lead, a, b] = [await make.person({ roleId: manager.id }), await make.person(), await make.person()]
    if (extras.length > 0) await make.extras(lead.id, ...extras)
    const client = await make.client()
    const task = await make.task()
    const [p1, p2] = [await make.project({ clientId: client.id }), await make.project({ clientId: client.id })]
    for (const { id: projectId } of [p1, p2]) await make.projectTask({ projectId, taskId: task.id })
    const membership = await make.projectMember({ projectId: p1.id, personId: lead.id, isManager: true })
    await make.manages(lead.id, a.id)
    const entry = async (personId: number, projectId: number) => {
      const { id } = await make.timeEntry({ personId, projectId, taskId: task.id })
      return { id, facts: { type: 'timeEntry', personId, projectId } as RecordFacts }
    }
    const times = {
      a1: await entry(a.id, p1.id), a2: await entry(a.id, p2.id), b1: await entry(b.id, p1.id), b2: await entry(b.id, p2.id),
      own1: await entry(lead.id, p1.id),
    }
    const actor = () => loadActor(database.db, lead.id)
    return { lead, a, b, client, p1, p2, membership, times, actor }
  }

  it('a lead sees time of their people everywhere, and of everyone on their projects', async () => {
    const { times, actor, p2 } = await setUp()
    const lead = await actor()
    const sees = Object.entries(times).filter(([, { facts }]) => can(lead, 'time.view', facts)).map(([name]) => name)
    expect(sees).toEqual(['a1', 'a2', 'b1', 'own1'])
    // Seeing the person's time there does not open the project.
    expect(can(lead, 'projects.view', { type: 'project', projectId: p2.id })).toBe(false)
  })

  it('a removed membership does not cover, although the flag is kept, and an archived project does', async () => {
    const { times, actor, p1, membership, client } = await setUp()
    const project = { type: 'project', projectId: p1.id } as const
    await database.db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, p1.id))
    expect(can(await actor(), 'projects.view', project)).toBe(true)
    await database.db.update(projectMembers).set({ removedAt: new Date() }).where(eq(projectMembers.id, membership.id))
    const lead = await actor()
    expect(can(lead, 'projects.view', project)).toBe(false)
    expect(can(lead, 'time.view', times.b1.facts)).toBe(false)
    expect(can(lead, 'time.view', times.a1.facts)).toBe(true)
    expect(can(lead, 'clients.view', { type: 'client', clientId: client.id })).toBe(false)
    const listed = await database.db.select().from(projects).where(filterFor(database.db, lead, 'projects.view', 'project'))
    expect(listed).toEqual([])
    const [row] = await database.db.select().from(projectMembers).where(eq(projectMembers.id, membership.id))
    expect(row?.isManager).toBe(true)
  })

  it('managing a manager does not cover their people', async () => {
    const { lead, a, actor } = await setUp()
    const boss = await make.person({ roleId: (await make.builtInRole('manager')).id })
    await make.manages(boss.id, lead.id)
    const above = await loadActor(database.db, boss.id)
    expect(can(above, 'people.view', { type: 'person', personId: lead.id })).toBe(true)
    expect(can(above, 'people.view', { type: 'person', personId: a.id })).toBe(false)
    expect(can(await actor(), 'people.view', { type: 'person', personId: a.id })).toBe(true)
  })

  it('one cannot approve one\'s own at managed, and can at all', async () => {
    const { times, actor, lead } = await setUp('time.approve', 'timeoff.approve')
    expect(can(await actor(), 'time.approve', times.b1.facts)).toBe(true)
    expect(can(await actor(), 'time.approve', times.own1.facts)).toBe(false)
    expect(can(await actor(), 'time.view', times.own1.facts)).toBe(true)
    const role = await make.role({ 'time.approve': 'all', 'time.view': 'all', 'timeoff.approve': 'all', 'people.view': 'all' })
    await database.db.update(people).set({ roleId: role.id }).where(eq(people.id, lead.id))
    expect(can(await actor(), 'time.approve', times.own1.facts)).toBe(true)
    expect(can(await actor(), 'timeoff.approve', { type: 'timeOffRequest', personId: lead.id })).toBe(true)
  })

  it('an invoice is covered when all its projects are managed, or by its maker when it has none', async () => {
    const { actor, lead, b, p1, p2, client } = await setUp('invoices.manage', 'billable.view', 'estimates.manage')
    const invoice = async (createdBy: number, ...projectIds: (number | null)[]) => {
      const { id } = await make.invoice({ clientId: client.id, createdBy })
      for (const [position, projectId] of projectIds.entries()) {
        await database.db.insert(invoiceLines).values({ invoiceId: id, position, projectId, kind: 'manual', quantity: 1000, unitPrice: 1, amount: 1 })
      }
      return id
    }
    const made = {
      managed: await invoice(b.id, p1.id, null), both: await invoice(lead.id, p1.id, p2.id), other: await invoice(b.id, p2.id),
      ownFree: await invoice(lead.id, null), othersFree: await invoice(b.id, null), ownEmpty: await invoice(lead.id),
    }
    const now = await actor()
    const decided = async (id: number) => {
      const facts = await readFacts(database.db, 'invoice', id)
      return facts !== undefined && can(now, 'invoices.manage', facts)
    }
    const covered: string[] = []
    for (const [name, id] of Object.entries(made)) if (await decided(id)) covered.push(name)
    expect(covered).toEqual(['managed', 'ownFree', 'ownEmpty'])
    const listed = await database.db.select().from(invoices).where(filterFor(database.db, now, 'invoices.manage', 'invoice'))
    expect(listed.map(({ id }) => id).sort()).toEqual([made.managed, made.ownFree, made.ownEmpty].sort())
    expect(errorOf(() => requireRecord(now, { view: 'invoices.manage' }, { type: 'invoice', projectIds: [p1.id, p2.id], createdBy: lead.id }))).toBe('NotFoundError')
  })

  it('an estimate is covered when it is linked to managed projects only, or by its maker when it is linked to none', async () => {
    const { actor, lead, b, p1, p2, client } = await setUp('estimates.manage', 'billable.view')
    let number = 0
    const estimate = async (createdBy: number, projectId: number | null, lineProject?: number) => {
      const values = { number: `E-${lead.id}-${++number}`, clientId: client.id, currency: 'USD', issuedOn: '2026-03-01', createdBy, projectId }
      const [row] = await database.db.insert(estimates).values(values).returning()
      const estimateId = row?.id ?? 0
      if (lineProject) await database.db.insert(estimateLines).values({ estimateId, position: 1, projectId: lineProject, quantity: 1000, unitPrice: 1, amount: 1 })
      return estimateId
    }
    const made = [
      await estimate(b.id, p1.id), await estimate(b.id, null, p1.id), await estimate(lead.id, null),
      await estimate(lead.id, p2.id), await estimate(lead.id, p1.id, p2.id), await estimate(b.id, null), await estimate(lead.id, null, p2.id),
    ]
    const now = await actor()
    const listed = await database.db.select().from(estimates).where(filterFor(database.db, now, 'estimates.manage', 'estimate'))
    expect(listed.map(({ id }) => id).sort()).toEqual(made.slice(0, 3).sort())
    for (const [index, id] of made.entries()) {
      const facts = await readFacts(database.db, 'estimate', id)
      expect(facts && can(now, 'estimates.manage', facts), String(index)).toBe(index < 3)
    }
  })

  it('an assignment of a placeholder is covered by its project only', async () => {
    const { actor, p1, p2 } = await setUp()
    const now = await actor()
    expect(can(now, 'schedule.view', { type: 'assignment', personId: null, projectId: p1.id })).toBe(true)
    expect(can(now, 'schedule.view', { type: 'assignment', personId: null, projectId: p2.id })).toBe(false)
  })

  it('answers in order: forbidden without the permission, not found when not covered, forbidden when it may only be seen', async () => {
    const { actor, times, a, b } = await setUp()
    const lead = await actor()
    const member = await loadActor(database.db, b.id)
    const asked = (who: Actor, facts: RecordFacts | undefined, orOwner = false) =>
      errorOf(() => requireRecord(who, { view: 'time.view', action: 'time.edit', orOwner }, facts))
    expect(asked(member, times.b2.facts)).toBe('forbidden')
    expect(asked(member, undefined)).toBe('forbidden')
    expect(asked(member, times.b2.facts, true)).toBeNull()
    expect(asked(member, times.a1.facts, true)).toBe('NotFoundError')
    expect(asked(lead, times.b2.facts, true)).toBe('NotFoundError')
    expect(asked(lead, undefined, true)).toBe('NotFoundError')
    expect(asked(lead, times.b1.facts, true)).toBe('forbidden')
    expect(errorOf(() => requireRecord(lead, { view: 'people.view' }, { type: 'person', personId: b.id }))).toBe('NotFoundError')
    expect(errorOf(() => requireRecord(lead, { view: 'people.view' }, { type: 'person', personId: a.id }))).toBeNull()
    expect(errorOf(() => requireAdministrator(lead))).toBe('forbidden')
  })

  it.each(['archived', 'pending'] as const)('someone %s has no permissions and no base access, whatever the role', async (status) => {
    for (const key of ['administrator', 'manager'] as const) {
      const { id } = await make.person({ status, roleId: (await make.builtInRole(key)).id })
      const actor = await loadActor(database.db, id)
      expect([actor.administrator, actor.grants]).toEqual([false, {}])
      expect(owns(actor, { type: 'timeEntry', personId: id, projectId: 1 })).toBe(false)
      expect(errorOf(() => ownId(actor))).toBe('forbidden')
      const own = filterFor(database.db, actor, 'people.view', 'person', { orOwner: true })
      expect(await database.db.select().from(people).where(own)).toEqual([])
    }
  })

  it('nobody who does not exist may do anything', async () => {
    expect(await loadActor(database.db, 999_999)).toMatchObject({ active: false, administrator: false, grants: {} })
  })

  it('what is stored and not known gives nothing', async () => {
    const role = await make.role({}, { permissions: ['old.key', 'old.key:all', 'time.view:everything', 'outbox.view:all'] })
    const person = await make.person({ roleId: role.id })
    expect((await loadActor(database.db, person.id)).grants).toEqual({ 'outbox.view': 'all' })
    const lead = await make.person({ roleId: (await make.builtInRole('manager')).id })
    await make.extras(lead.id, 'people.manage', 'old.key' as PermissionKey, 'cost.view')
    expect((await loadActor(database.db, lead.id)).grants).toMatchObject({ 'cost.view': 'managed' })
    expect((await loadActor(database.db, lead.id)).grants).not.toHaveProperty('people.manage')
  })

  it('a system actor may do everything, and cannot be made from data', () => {
    const system = systemActor('tests')
    expect(can(system, 'cost.view', { type: 'project', projectId: 1 })).toBe(true)
    expect(holds(system, 'outbox.view', 'all')).toBe(true)
    expect(system).toBeInstanceOf(SystemActor)
    const fake = JSON.parse(JSON.stringify({ ...system, grants: {}, managed: { projects: [], people: [], clients: [] } })) as Actor
    expect(can(fake, 'cost.view', { type: 'project', projectId: 1 })).toBe(false)
    expect(holds(fake, 'outbox.view')).toBe(false)
  })
})
