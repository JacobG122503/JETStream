// Billable and cost figures on records of the demo, for actors with and without the permissions.
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Grants, managerExtras, permissionCatalogue } from '../../shared/permissions'
import type { Database } from '../db'
import { people, personManagers, personRates, projectMembers, projects, timeEntries } from '../db/schema'
import { seedDemo } from '../demo'
import { ApiError } from '../errors'
import { makeRecords } from '../testing/records'
import { createTestDatabase } from '../testing/testDatabase'
import { loadActor, type PersonActor } from './actor'
import type { RecordFacts } from './decisions'
import { moneyValue, visibleFields } from './fields'
import { systemActor } from './system'

let database: Database
const actors: Record<string, PersonActor> = {}
let led: number[] = []
let team: number[] = []

const billableKeys = ['rate', 'billableRate', 'billableAmount', 'fixedFee', 'budgetAmount']
const costKeys = ['costRate', 'cost', 'margin']

beforeAll(async () => {
  database = await createTestDatabase()
  const { db } = database
  await seedDemo(db, { today: '2026-03-04' })
  const make = makeRecords(db)
  const byEmail = async (email: string) => (await db.select().from(people).where(eq(people.email, email)))[0]?.id ?? 0
  const lead = await byEmail('lead@jet.demo')
  led = (await db.select().from(projectMembers).where(eq(projectMembers.personId, lead))).filter(({ isManager }) => isManager).map(({ projectId }) => projectId)
  team = (await db.select().from(personManagers).where(eq(personManagers.managerId, lead))).map(({ personId }) => personId)
  const manager = await make.builtInRole('manager')
  const copy = async (roleId: number) => {
    const person = await make.person({ roleId })
    for (const projectId of led) await make.projectMember({ projectId, personId: person.id, isManager: true })
    for (const personId of team) await make.manages(person.id, personId)
    return person.id
  }
  const scoped = (level: 'managed' | 'all') =>
    Object.fromEntries(permissionCatalogue.filter(({ levels }) => levels.includes('managed')).map(({ key }) => [key, level])) as Grants
  const extras = await copy(manager.id)
  await make.extras(extras, ...managerExtras)
  const nothing = await make.person({ roleId: manager.id })
  await make.extras(nothing.id, ...managerExtras)
  const ids = {
    administrator: await byEmail('admin@jet.demo'), lead, member: await byEmail('employee@jet.demo'), manager: await copy(manager.id),
    managerWithExtras: extras, managerOfNothing: nothing.id, bookkeeper: await byEmail('elena.marchetti@jet.example'),
    customManaged: await copy((await make.role(scoped('managed'))).id), customAll: (await make.person({ roleId: (await make.role(scoped('all'))).id })).id,
  }
  for (const [name, id] of Object.entries(ids)) actors[name] = await loadActor(db, id)
})
afterAll(() => database.close())

/** Where each actor sees billable and cost figures. */
const reach: Record<string, { billable: 'all' | 'managed' | 'none'; cost: 'all' | 'managed' | 'none' }> = {
  administrator: { billable: 'all', cost: 'all' },
  lead: { billable: 'managed', cost: 'none' },
  member: { billable: 'none', cost: 'none' },
  manager: { billable: 'none', cost: 'none' },
  managerWithExtras: { billable: 'managed', cost: 'managed' },
  managerOfNothing: { billable: 'none', cost: 'none' },
  bookkeeper: { billable: 'all', cost: 'none' },
  customManaged: { billable: 'managed', cost: 'managed' },
  customAll: { billable: 'all', cost: 'all' },
}

async function samples(): Promise<{ record: RecordFacts; json: Record<string, unknown>; managed: boolean }[]> {
  const { db } = database
  const rates = await db.select().from(personRates)
  const rateOf = (personId: number, kind: string) => rates.find((row) => row.personId === personId && row.kind === kind)?.rate ?? 0
  const persons = (await db.select().from(people)).map(({ id, name }) => ({
    record: { type: 'person', personId: id } as const,
    json: { id, name, billableRate: rateOf(id, 'billable'), costRate: rateOf(id, 'cost') },
    managed: team.includes(id),
  }))
  const allProjects = (await db.select().from(projects)).map(({ id, name, rate, rateMethod, fixedFee, budgetAmount, budgetMinutes }) => ({
    record: { type: 'project', projectId: id } as const,
    json: { id, name, rateMethod, budgetMinutes, rate, fixedFee, budgetAmount, cost: 1, margin: 2, tasks: [{ taskId: 1, rate: 5 }] },
    managed: led.includes(id),
  }))
  const members = (await db.select().from(projectMembers)).map(({ projectId, personId, rate }) => ({
    record: { type: 'project', projectId } as const,
    json: { personId, rate, billableRate: rateOf(personId, 'billable'), costRate: rateOf(personId, 'cost') },
    managed: led.includes(projectId),
  }))
  const entries = (await db.select().from(timeEntries).orderBy(asc(timeEntries.id)).limit(400)).map(({ id, personId, projectId, minutes }) => ({
    record: { type: 'timeEntry', personId, projectId } as const,
    json: { id, minutes, billableRate: 100, billableAmount: 200, costRate: 50, cost: 100, margin: 100 },
    managed: led.includes(projectId) || team.includes(personId),
  }))
  return [...persons, ...allProjects, ...members, ...entries]
}

describe('billable and cost fields', () => {
  it('are left out for whoever may not see them on that record, and nothing else is', async () => {
    const all = await samples()
    expect(all.some(({ managed }) => managed) && all.some(({ managed }) => !managed)).toBe(true)
    for (const [name, actor] of Object.entries(actors)) {
      const seen = { billable: 0, cost: 0 }
      for (const { record, json, managed } of all) {
        const result = JSON.parse(JSON.stringify(visibleFields(actor, record, json))) as Record<string, unknown>
        const sees = (kind: 'billable' | 'cost') => reach[name]?.[kind] === 'all' || (reach[name]?.[kind] === 'managed' && managed)
        const hidden = [...(sees('billable') ? [] : billableKeys), ...(sees('cost') ? [] : costKeys)]
        for (const kind of ['billable', 'cost'] as const) if (sees(kind)) seen[kind]++
        const expected = Object.keys(json).filter((key) => !hidden.includes(key))
        expect(Object.keys(result), `${name} on ${JSON.stringify(record)}`).toEqual(expected)
        // Not in its parts either.
        for (const key of hidden) expect(JSON.stringify(result), `${name} on ${JSON.stringify(record)}`).not.toContain(`"${key}":`)
      }
      expect([name, seen.billable > 0, seen.cost > 0]).toEqual([name, reach[name]?.billable !== 'none', reach[name]?.cost !== 'none'])
    }
  })

  it('employees see neither on their own time, and a lead billable but no cost', () => {
    const json = { id: 1, billableRate: 1, costRate: 2 }
    const member = actors.member as PersonActor
    expect(visibleFields(member, { type: 'timeEntry', personId: member.id, projectId: led[0] ?? 0 }, json)).toEqual({ id: 1 })
    expect(visibleFields(actors.lead as PersonActor, { type: 'project', projectId: led[0] ?? 0 }, { personId: 3, ...json })).toEqual({ personId: 3, id: 1, billableRate: 1 })
  })

  it('an expense keeps its own amount, and dates and nulls stay as they are', () => {
    const member = actors.member as PersonActor
    const createdAt = new Date()
    const record = { type: 'expense', personId: member.id, projectId: 1 } as const
    expect(visibleFields(member, record, { amount: 500, unitPrice: 5, cost: 1, createdAt, notes: null })).toEqual({ amount: 500, unitPrice: 5, createdAt, notes: null })
  })

  it('a figure the rule does not know is an error, not let through', () => {
    for (const name of ['hourlyRate', 'totalAmount', 'grossMargin', 'extra_cost', 'salePrice']) {
      expect(() => visibleFields(systemActor('tests'), { type: 'person', personId: 1 }, { [name]: 1 }), name).toThrow(name)
    }
    expect(visibleFields(actors.member as PersonActor, { type: 'project', projectId: 1 }, { corporate: 1, separateInvoices: true })).toEqual({ corporate: 1, separateInvoices: true })
  })
})

describe('sorting and filtering by such a field', () => {
  const problem = (actor: PersonActor, type: 'timeEntry' | 'person' | 'project', field: string) => {
    try {
      moneyValue(database.db, actor, type, field, personRates.rate)
      return null
    } catch (error) {
      return error instanceof ApiError ? [error.status, error.code] : error
    }
  }

  it('is refused for whoever may see it nowhere', () => {
    for (const type of ['person', 'project', 'timeEntry'] as const) {
      for (const [name, actor] of Object.entries(actors)) {
        const holds = (key: 'billable.view' | 'cost.view') => actor.grants[key] !== undefined
        for (const field of billableKeys) expect(problem(actor, type, field), `${name} ${field}`).toEqual(holds('billable.view') ? null : [400, 'bad_request'])
        for (const field of costKeys) expect(problem(actor, type, field), `${name} ${field}`).toEqual(holds('cost.view') ? null : [400, 'bad_request'])
      }
    }
    expect(problem(actors.lead as PersonActor, 'project', 'costRate')).toEqual([400, 'bad_request'])
    expect(problem(actors.administrator as PersonActor, 'project', 'passwordHash')).toEqual([400, 'bad_request'])
  })

  it('treats it as empty on the rows where it may not be seen', async () => {
    const { db } = database
    const value = moneyValue(db, actors.lead as PersonActor, 'project', 'rate', projects.rate).mapWith(projects.rate)
    const rows = await db.select({ id: projects.id, value, rate: projects.rate }).from(projects)
    for (const row of rows) expect(row.value, String(row.id)).toBe(led.includes(row.id) ? row.rate : null)
    expect(rows.some((row) => row.rate !== null && row.value === null)).toBe(true)
    const sorted = await db.select({ id: projects.id }).from(projects).orderBy(asc(value))
    expect(sorted).toHaveLength(rows.length)
  })
})
