// The demo pages' API, over the demo company.
import type { Express } from 'express'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays } from '../../shared/dates'
import type {
  ClientDetails, ClientRow, ExpenseOptions, ExpenseRow, HomeInfo, InvoiceDetails, InvoiceList, ProjectDetails, ProjectRow, TimeProject,
  TimeReport, TimeWeek, UnbilledClient,
} from '../../shared/work'
import type { Database } from '../db'
import { companySettings, invoiceTimeEntries, people, projectMembers, timeEntries } from '../db/schema'
import { demoPassword } from '../demo/accounts'
import { seedDemo } from '../demo'
import { type Browser, signedIn, testApp, testClock } from '../testing/apiClient'
import { createTestDatabase } from '../testing/testDatabase'
import { stoppedMinutes } from './time'

const today = '2026-11-24'
const clock = testClock('2026-11-24T16:00:00Z')
let database: Database
let app: Express
let admin: Browser
let lead: Browser
let employee: Browser
beforeAll(async () => {
  database = await createTestDatabase()
  await seedDemo(database.db, { today })
  app = testApp({ db: database.db, now: clock.now })
  admin = await signedIn(app, 'admin@jet.demo', demoPassword)
  lead = await signedIn(app, 'lead@jet.demo', demoPassword)
  employee = await signedIn(app, 'employee@jet.demo', demoPassword)
}, 60_000)
afterAll(() => database.close())

async function get<T>(client: Browser, path: string): Promise<T> {
  const response = await client.get(path)
  expect(response.status, path).toBe(200)
  return response.body as T
}
const codeOf = (response: { status: number; body: unknown }) => [response.status, (response.body as { error?: { code: string } }).error?.code]
const projectsOf = async (client: Browser) => (await get<{ projects: ProjectRow[] }>(client, '/projects')).projects
const idOf = async (email: string) => (await database.db.select().from(people).where(eq(people.email, email)))[0]?.id ?? 0

describe('time', () => {
  const options = async () => (await get<{ projects: TimeProject[] }>(employee, '/time/options')).projects
  const input = async (more: object = {}) => {
    const [project] = await options()
    return { projectId: project?.id, taskId: project?.tasks[0]?.id, spentOn: today, minutes: 90, notes: 'Site walk', ...more }
  }

  it('offers the projects the person is on, and only those', async () => {
    const offered = (await options()).map(({ id }) => id).sort()
    const on = await database.db.select().from(projectMembers).where(eq(projectMembers.personId, await idOf('employee@jet.demo')))
    expect(offered).toEqual(on.map(({ projectId }) => projectId).sort())
  })

  it('is entered, changed and deleted', async () => {
    const made = await employee.post('/time', await input())
    expect(made.status).toBe(201)
    const entry = (made.body as TimeWeek).entries.find(({ spentOn }) => spentOn === today)
    expect(entry).toMatchObject({ minutes: 90, notes: 'Site walk', locked: null })
    const changed = await employee.put(`/time/${entry?.id}`, await input({ minutes: 45, version: entry?.version }))
    expect((changed.body as TimeWeek).entries.find(({ id }) => id === entry?.id)).toMatchObject({ minutes: 45 })
    expect(codeOf(await employee.put(`/time/${entry?.id}`, await input({ version: entry?.version })))).toEqual([409, 'stale'])
    expect((await employee.post(`/time/${entry?.id}/delete`, { version: (entry?.version ?? 0) + 1 })).status).toBe(200)
    expect((await get<TimeWeek>(employee, '/time')).entries.some(({ id }) => id === entry?.id)).toBe(false)
  })

  it('is refused on projects of others, for too many minutes, and for a date that is none', async () => {
    const foreign = (await projectsOf(admin)).find(({ code }) => code === 'KES-301')
    expect(codeOf(await employee.post('/time', await input({ projectId: foreign?.id })))).toEqual([400, 'invalid_input'])
    expect(codeOf(await employee.post('/time', await input({ minutes: 1441 })))).toEqual([400, 'invalid_input'])
    expect(codeOf(await employee.post('/time', await input({ spentOn: '2026-02-30' })))).toEqual([400, 'invalid_input'])
  })

  it("cannot be changed once approved, and someone else's is not even there", async () => {
    const old = (await get<TimeWeek>(employee, `/time?date=${addDays(today, -21)}`)).entries[0]
    expect(old?.locked).not.toBeNull()
    const refused = await employee.put(`/time/${old?.id}`, await input({ version: old?.version }))
    expect(refused.status).toBe(409)
    const theirs = (await get<TimeWeek>(lead, '/time')).entries[0]
    expect(codeOf(await employee.put(`/time/${theirs?.id}`, await input({ version: theirs?.version })))).toEqual([404, 'not_found'])
    expect(codeOf(await employee.post(`/time/${theirs?.id}/delete`, { version: theirs?.version }))).toEqual([404, 'not_found'])
  })

  it('cannot be added to a week that was handed in, or to a closed period', async () => {
    expect(codeOf(await employee.post('/time', await input({ spentOn: addDays(today, -21) })))).toEqual([409, 'period_closed'])
    await database.db.update(companySettings).set({ lockedThrough: today })
    expect(codeOf(await employee.post('/time', await input()))).toEqual([409, 'period_closed'])
    await database.db.update(companySettings).set({ lockedThrough: null })
  })

  it('runs one timer at a time, and adds what it measured', async () => {
    const first = await employee.post('/time', await input({ minutes: 0, start: true, notes: 'one' }))
    const running = (first.body as TimeWeek).running
    expect(running).toMatchObject({ notes: 'one', minutes: 0 })
    clock.forward(25)
    const second = await employee.post('/time', await input({ minutes: 10, start: true, notes: 'two' }))
    expect((second.body as TimeWeek).running).toMatchObject({ notes: 'two' })
    expect((second.body as TimeWeek).entries.find(({ id }) => id === running?.id)).toMatchObject({ minutes: 25, timerStartedAt: null })
    clock.forward(5)
    await employee.post('/time/stop')
    const week = await get<TimeWeek>(employee, '/time')
    expect(week.running).toBeNull()
    const two = week.entries.find(({ notes }) => notes === 'two')
    expect(two).toMatchObject({ minutes: 15 })
    await employee.post(`/time/${two?.id}/start`, { version: two?.version })
    expect((await get<HomeInfo>(employee, '/home')).running).toMatchObject({ id: two?.id })
    await employee.post('/time/stop')
  })

  it('counts at most a day', () => {
    const start = new Date('2026-11-24T00:00:00Z')
    expect(stoppedMinutes(60, start, new Date('2026-11-26T00:00:00Z'))).toBe(1440)
    expect(stoppedMinutes(60, start, new Date('2026-11-23T00:00:00Z'))).toBe(60)
  })
})

describe('projects and clients', () => {
  it('are seen by those on them, those who manage them, and those who see all', async () => {
    const all = await projectsOf(admin)
    const own = await projectsOf(employee)
    expect(all.length).toBeGreaterThan(own.length)
    expect(own.every(({ members }) => members.some(({ name }) => name === 'Casey Lindgren'))).toBe(true)
    const foreign = all.find(({ code }) => code === 'KES-301')
    expect(codeOf(await employee.get(`/projects/${foreign?.id}`))).toEqual([404, 'not_found'])
  })

  it('tell amounts only to those who may see them', async () => {
    const turbine = (await projectsOf(admin)).find(({ code }) => code === 'TGW-101')
    const asAdmin = await get<ProjectDetails>(admin, `/projects/${turbine?.id}`)
    expect(asAdmin.billableAmount).toBeGreaterThan(0)
    expect(asAdmin.budget).toMatchObject({ unit: 'fees' })
    const asEmployee = await employee.get(`/projects/${turbine?.id}`)
    expect(JSON.stringify(asEmployee.body)).not.toMatch(/amount|"rate"|fixedFee|"unit":"fees"/i)
    const { people: team } = asEmployee.body as ProjectDetails
    expect(team.filter(({ minutes }) => minutes > 0).map(({ name }) => name)).toEqual(['Casey Lindgren'])
  })

  it('are made by those who may, who then manage them', async () => {
    const choices = await get<{ clients: { id: number }[]; tasks: { id: number }[] }>(lead, '/projects/options')
    const body = {
      clientId: choices.clients[0]?.id, name: 'Hoist replacement', code: 'H-1', type: 'time_materials', budgetMinutes: 6000,
      taskIds: [choices.tasks[0]?.id], personIds: [await idOf('employee@jet.demo')],
    }
    expect(codeOf(await employee.post('/projects', body))).toEqual([403, 'forbidden'])
    expect(codeOf(await lead.post('/projects', { ...body, rate: 10_000 }))).toEqual([403, 'forbidden'])
    const made = await lead.post('/projects', body)
    expect(made.status).toBe(201)
    const project = await get<ProjectDetails>(lead, `/projects/${(made.body as { id: number }).id}`)
    expect(project.people).toMatchObject([{ name: 'Casey Lindgren', isManager: false }, { name: 'Jordan Blake', isManager: true }])
    expect(project.budget).toMatchObject({ unit: 'hours', used: 0, total: 6000 })
  })

  it('clients are listed with their projects, and not for employees', async () => {
    const { clients } = await get<{ clients: ClientRow[] }>(admin, '/clients')
    expect(clients.map(({ name }) => name)).toContain('Lumen Ridge Foods')
    const details = await get<ClientDetails>(admin, `/clients/${clients[0]?.id}`)
    expect(details.projects.every(({ client }) => client.id === clients[0]?.id)).toBe(true)
    expect(codeOf(await employee.get('/clients'))).toEqual([403, 'forbidden'])
    expect((await get<{ clients: ClientRow[] }>(lead, '/clients')).clients.length).toBeLessThan(clients.length)
    expect(codeOf(await admin.post('/clients', { name: 'lumen ridge foods', currency: 'USD', address: '' }))).toEqual([400, 'invalid_input'])
    expect((await admin.post('/clients', { name: 'Harbor Glass', currency: 'USD', address: '' })).status).toBe(201)
  })
})

describe('expenses', () => {
  it('are entered as an amount or as units, changed and deleted', async () => {
    const { projects, categories } = await get<ExpenseOptions>(employee, '/expenses/options')
    const mileage = categories.find(({ unitName }) => unitName !== null)
    const meals = categories.find(({ unitName }) => unitName === null)
    const body = { projectId: projects[0]?.id, spentOn: today, notes: 'Trip', billable: true, reimbursable: true, quantity: null, amount: 0 }
    const list = async (response: { body: unknown }) => (response.body as { expenses: ExpenseRow[] }).expenses[0]
    const driven = await list(await employee.post('/expenses', { ...body, categoryId: mileage?.id, quantity: 10_000 }))
    expect(driven).toMatchObject({ quantity: 10_000, amount: Math.round((mileage?.unitPrice ?? 0) / 100), reimbursementStatus: 'pending' })
    expect(codeOf(await employee.post('/expenses', { ...body, categoryId: meals?.id }))).toEqual([400, 'invalid_input'])
    const eaten = await list(await employee.post('/expenses', { ...body, categoryId: meals?.id, amount: 1850 }))
    const changed = await employee.put(`/expenses/${eaten?.id}`, { ...body, categoryId: meals?.id, amount: 2000, version: eaten?.version })
    expect(await list(changed)).toMatchObject({ amount: 2000 })
    expect((await employee.post(`/expenses/${eaten?.id}/delete`, { version: (eaten?.version ?? 0) + 1 })).status).toBe(200)
    expect(codeOf(await lead.post(`/expenses/${driven?.id}/delete`, { version: driven?.version }))).toEqual([403, 'forbidden'])
  })
})

describe('from hours to money', () => {
  it('an invoice is made of what is not billed yet, marked as sent and paid, and nothing is billed twice', async () => {
    const before = (await get<{ clients: UnbilledClient[] }>(admin, '/invoices/unbilled')).clients.find(({ name }) => name === 'Tallgrass Wind Cooperative')
    if (!before) throw new Error('Nothing to bill')
    expect(before.total).toBeGreaterThan(0)
    const body = { clientId: before.id, projectIds: before.projects.map(({ id }) => id), from: null, to: null, grouping: 'task', withExpenses: true, subject: 'Work' }
    const made = await admin.post('/invoices', body)
    expect(made.status).toBe(201)
    const { id } = made.body as { id: number }
    const draft = await get<InvoiceDetails>(admin, `/invoices/${id}`)
    expect(draft).toMatchObject({ status: 'draft', subtotal: before.total, canPay: false })
    expect(codeOf(await admin.post('/invoices', body))).toEqual([409, 'nothing_to_bill'])

    expect(codeOf(await admin.post(`/invoices/${id}/payments`, { amount: 100, paidOn: today, method: 'check', reference: '' }))).toEqual([409, 'invoice_not_payable'])
    const open = (await admin.post(`/invoices/${id}/send`, { version: draft.version })).body as InvoiceDetails
    expect(open).toMatchObject({ status: 'open', canPay: true })
    expect(codeOf(await admin.post(`/invoices/${id}/delete`, { version: open.version }))).toEqual([409, 'not_a_draft'])
    expect(codeOf(await admin.post(`/invoices/${id}/payments`, { amount: open.dueAmount + 1, paidOn: today, method: 'check', reference: '' }))).toEqual([409, 'payment_exceeds_due'])
    expect(codeOf(await admin.post(`/invoices/${id}/payments`, { amount: 1, paidOn: today, method: 'online', reference: '' }))).toEqual([400, 'invalid_input'])
    const paid = await admin.post(`/invoices/${id}/payments`, { amount: open.dueAmount, paidOn: today, method: 'check', reference: 'Check 12' })
    expect(paid.body).toMatchObject({ status: 'paid', dueAmount: 0 })
  })

  it('a deleted draft frees its hours again', async () => {
    const find = async () => (await get<{ clients: UnbilledClient[] }>(admin, '/invoices/unbilled')).clients.find(({ name }) => name === 'Fernhollow Water Utility')
    const before = await find()
    const made = await admin.post('/invoices', { clientId: before?.id, projectIds: before?.projects.map(({ id }) => id), grouping: 'person', withExpenses: false, subject: '' })
    const { id } = made.body as { id: number }
    const draft = await get<InvoiceDetails>(admin, `/invoices/${id}`)
    expect(await find()).not.toEqual(before)
    expect((await admin.post(`/invoices/${id}/delete`, { version: draft.version })).status).toBe(200)
    expect(await find()).toEqual(before)
  })

  it('is not for those without the permission, and the lead cannot reach it by any address', async () => {
    const { invoices } = await get<InvoiceList>(admin, '/invoices')
    expect(invoices.some(({ late }) => late)).toBe(true)
    for (const client of [lead, employee]) {
      for (const path of ['/invoices', '/invoices/unbilled', `/invoices/${invoices[0]?.id}`]) {
        expect(codeOf(await client.get(path))).toEqual([403, 'forbidden'])
      }
      expect(codeOf(await client.post('/invoices', {}))).toEqual([403, 'forbidden'])
      expect(codeOf(await client.post(`/invoices/${invoices[0]?.id}/payments`, {}))).toEqual([403, 'forbidden'])
    }
  })

  it('what is not billed yet is worth what billing makes of it', async () => {
    const links = await database.db.select().from(invoiceTimeEntries)
    const { loadValued } = await import('./figures')
    const valued = new Map((await loadValued(database.db, undefined)).map((row) => [row.id, row]))
    const differing = links.filter(({ timeEntryId, amount, minutes }) => {
      const row = valued.get(timeEntryId)
      return row?.amount !== amount || row.worked !== minutes
    })
    expect(links.length).toBeGreaterThan(500)
    expect(differing).toEqual([])
  })
})

describe('reports and home', () => {
  const report = (client: Browser) => get<TimeReport>(client, `/reports/time?from=${addDays(today, -30)}&to=${today}`)

  it('add up, and hold only what the person may see', async () => {
    const all = await report(admin)
    const own = await report(employee)
    expect(all.scope).toBe('team')
    for (const rows of [all.byClient, all.byProject, all.byTask, all.byPerson]) {
      expect(rows.reduce((sum, { minutes }) => sum + minutes, 0)).toBe(all.minutes)
    }
    expect(all.byDay.reduce((sum, { billable, other }) => sum + billable + other, 0)).toBe(all.minutes)
    expect(own).toMatchObject({ scope: 'own', amounts: [] })
    expect(own.byPerson.map(({ name }) => name)).toEqual(['Casey Lindgren'])
    expect(own.byProject.every(({ amount }) => amount === null)).toBe(true)
    const led = await report(lead)
    expect(led.minutes).toBeLessThan(all.minutes)
    expect(led.minutes).toBeGreaterThan(own.minutes)
    const entries = await database.db.select().from(timeEntries)
    const mine = entries.filter(({ spentOn }) => spentOn >= addDays(today, -30) && spentOn <= today)
    expect(all.minutes).toBe(mine.reduce((sum, { minutes }) => sum + minutes, 0))
  })

  it('refuse periods that make no sense', async () => {
    expect(codeOf(await admin.get('/reports/time'))).toEqual([400, 'invalid_input'])
    expect(codeOf(await admin.get(`/reports/time?from=${today}&to=2026-01-01`))).toEqual([400, 'invalid_input'])
    expect(codeOf(await admin.get('/reports/time?from=1000-01-01&to=9999-01-01'))).toEqual([400, 'invalid_input'])
  })

  it('home shows money and team only to those who may see them', async () => {
    const office = await get<HomeInfo>(admin, '/home')
    expect(office.money?.outstanding.length).toBeGreaterThan(0)
    expect(office.money?.months).toHaveLength(6)
    expect(office.team?.length).toBeGreaterThan(5)
    const led = await get<HomeInfo>(lead, '/home')
    expect(led.money).toBeUndefined()
    expect(led.team?.map(({ name }) => name)).toContain('Casey Lindgren')
    const own = await get<HomeInfo>(employee, '/home')
    expect([own.money, own.team]).toEqual([undefined, undefined])
    expect(own.week).toHaveLength(7)
    expect(own.recent.length).toBeGreaterThan(0)
  })
})
