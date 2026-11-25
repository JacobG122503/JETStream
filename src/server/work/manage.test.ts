// Settings, clients, projects, tasks and people: changing them, over the demo company.
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySettings, ClientDetails, PersonWork, ProjectDetails, ProjectOptions, TaskRow, TimeWeek } from '../../shared/work'
import type { Database } from '../db'
import { activityLog, people, personRates, projectMembers, projects } from '../db/schema'
import { demoPassword } from '../demo/accounts'
import { seedDemo } from '../demo'
import { accounts, type Browser, signedIn, testApp, testClock } from '../testing/apiClient'
import { createTestDatabase } from '../testing/testDatabase'

const today = '2026-11-24'
const clock = testClock('2026-11-24T16:00:00Z')
let database: Database
let admin: Browser
let lead: Browser
let employee: Browser
let editor: Browser
beforeAll(async () => {
  database = await createTestDatabase()
  await seedDemo(database.db, { today })
  const app = testApp({ db: database.db, now: clock.now })
  admin = await signedIn(app, 'admin@jet.demo', demoPassword)
  lead = await signedIn(app, 'lead@jet.demo', demoPassword)
  employee = await signedIn(app, 'employee@jet.demo', demoPassword)
  const other = await accounts(database.db)({ 'people.view': 'all', 'people.manage': 'all', 'projects.view': 'all', 'projects.edit': 'all' })
  editor = await signedIn(app, other.email)
}, 60_000)
afterAll(() => database.close())

async function get<T>(client: Browser, path: string): Promise<T> {
  const response = await client.get(path)
  expect(response.status, path).toBe(200)
  return response.body as T
}
const codeOf = (response: { status: number; body: unknown }) => [response.status, (response.body as { error?: { code: string } }).error?.code]
const projectId = async (code: string) => (await database.db.select().from(projects).where(eq(projects.code, code)))[0]?.id ?? 0
const personId = async (email: string) => (await database.db.select().from(people).where(eq(people.email, email)))[0]?.id ?? 0

describe('settings', () => {
  it('are changed by those who may, and noted', async () => {
    const before = await get<CompanySettings>(admin, '/settings')
    expect(codeOf(await lead.get('/settings'))).toEqual([403, 'forbidden'])
    const { version, logoFileId: _logo, ...rest } = before
    const saved = await admin.put('/settings', { ...rest, hourFormat: 'hours_minutes', reminderDays: [30, 3, 3], version })
    expect(saved.body).toMatchObject({ hourFormat: 'hours_minutes', reminderDays: [3, 30] })
    expect(codeOf(await admin.put('/settings', { ...rest, version }))).toEqual([409, 'stale'])
    expect(codeOf(await admin.put('/settings', { ...rest, currency: 'EUR', version: version + 1 }))).toEqual([409, 'currency_locked'])
    expect(codeOf(await admin.put('/settings', { ...rest, paymentTerms: 'custom', version: version + 1 }))).toEqual([400, 'invalid_input'])
    expect((await admin.get('/session')).body).toMatchObject({ company: { formats: { hourFormat: 'hours_minutes' } } })
    const log = await database.db.select().from(activityLog).where(eq(activityLog.subjectType, 'settings'))
    expect(log.at(-1)?.changes).toMatchObject({ hourFormat: ['decimal', 'hours_minutes'] })
    expect((await get<{ rows: { summary: string }[] }>(admin, '/activity?search=company')).rows[0]?.summary).toBe('Changed the company settings')
    expect(codeOf(await lead.get('/activity'))).toEqual([403, 'forbidden'])
  })
})

describe('clients', () => {
  const client = async () => {
    const { id } = (await admin.post('/clients', { name: `Client ${Math.random()}`, currency: 'USD', address: '' })).body as { id: number }
    return get<ClientDetails>(admin, `/clients/${id}`)
  }
  const input = ({ name, currency, address, notes, billing }: ClientDetails) => ({ name, currency, address, notes, ...billing })

  it('are changed with a check for other changes, and archived, restored and deleted', async () => {
    const one = await client()
    expect((await admin.put(`/clients/${one.id}`, { ...input(one), currency: 'EUR', tax1Name: 'VAT', tax1Percent: 19_000, version: one.version })).body).toMatchObject({ currency: 'EUR' })
    expect(codeOf(await admin.put(`/clients/${one.id}`, { ...input(one), version: one.version }))).toEqual([409, 'stale'])
    expect((await admin.post(`/clients/${one.id}/archive`, { archive: true })).status).toBe(200)
    expect((await get<ClientDetails>(admin, `/clients/${one.id}`)).archived).toBe(true)
    expect((await admin.post(`/clients/${one.id}/archive`, { archive: false })).status).toBe(200)
    expect((await admin.delete(`/clients/${one.id}`)).status).toBe(200)
    expect(codeOf(await admin.get(`/clients/${one.id}`))).toEqual([404, 'not_found'])
  })

  it('with work keep their currency, and cannot be archived or deleted', async () => {
    const { clients } = await get<{ clients: { id: number; name: string }[] }>(admin, '/clients')
    const id = clients.find(({ name }) => name.startsWith('Tallgrass'))?.id
    const one = await get<ClientDetails>(admin, `/clients/${id}`)
    expect(one.currencyLocked).toMatch(/invoices/)
    expect(codeOf(await admin.put(`/clients/${id}`, { ...input(one), currency: 'EUR', version: one.version }))).toEqual([409, 'currency_locked'])
    expect(codeOf(await admin.post(`/clients/${id}/archive`, { archive: true }))).toEqual([409, 'client_in_use'])
    expect(codeOf(await admin.delete(`/clients/${id}`))).toEqual([409, 'client_in_use'])
    for (const call of [() => lead.put(`/clients/${id}`, {}), () => lead.post(`/clients/${id}/archive`, { archive: true }), () => lead.delete(`/clients/${id}`)]) {
      expect(codeOf(await call())).toEqual([403, 'forbidden'])
    }
  })

  it('have contacts, which belong to them alone', async () => {
    const [one, two] = [await client(), await client()]
    const contact = { name: 'Kim Fictional', title: '', email: 'kim@client.example', officePhone: null, mobilePhone: null }
    expect((await admin.post(`/clients/${one.id}/contacts`, contact)).status).toBe(201)
    const [made] = (await get<ClientDetails>(admin, `/clients/${one.id}`)).contactList
    expect(codeOf(await admin.put(`/clients/${two.id}/contacts/${made?.id}`, { ...contact, version: 1 }))).toEqual([404, 'not_found'])
    expect((await admin.put(`/clients/${one.id}/contacts/${made?.id}`, { ...contact, name: 'Kim Changed', version: made?.version })).status).toBe(200)
    expect(codeOf(await admin.post(`/clients/${one.id}/contacts`, { ...contact, email: 'not an email' }))).toEqual([400, 'invalid_input'])
    expect((await admin.delete(`/clients/${one.id}/contacts/${made?.id}`)).status).toBe(200)
    expect((await get<ClientDetails>(admin, `/clients/${one.id}`)).contactList).toEqual([])
  })
})

describe('projects', () => {
  const input = (project: ProjectDetails, more: object = {}) => ({ ...project, rate: project.rate ?? null, fixedFee: project.fixedFee ?? null, budgetAmount: project.budgetAmount ?? null, ...more })

  it('are changed; amounts only by those who may, and others leave them as they are', async () => {
    const id = await projectId('LRF-401')
    const one = await get<ProjectDetails>(lead, `/projects/${id}`)
    expect(one.canEdit).toBe(true)
    const saved = await lead.put(`/projects/${id}`, input(one, { name: 'Cold store', rate: 1, tags: ['Steel', 'steel', 'North'] }))
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ name: 'Cold store', rate: 12_800 })
    expect((saved.body as ProjectDetails).tags.map((tag) => tag.toLowerCase())).toEqual(['north', 'steel'])
    expect(codeOf(await lead.put(`/projects/${id}`, input(one, { version: (saved.body as ProjectDetails).version, budgetType: 'total_fees', budgetAmount: 100 })))).toEqual([403, 'forbidden'])
    expect(codeOf(await admin.put(`/projects/${id}`, input(one)))).toEqual([409, 'stale'])
    expect((await admin.put(`/projects/${id}`, input(saved.body as ProjectDetails, { rate: 13_000 }))).body).toMatchObject({ rate: 13_000 })
    expect(codeOf(await employee.put(`/projects/${id}`, {}))).toEqual([403, 'forbidden'])
    expect(codeOf(await lead.put(`/projects/${await projectId('KES-301')}`, input(one)))).toEqual([404, 'not_found'])
  })

  it('get and lose tasks, keeping time and rates', async () => {
    const id = await projectId('FWU-201')
    const one = await get<ProjectDetails>(admin, `/projects/${id}`)
    const rows = one.tasks.map(({ id: taskId, billable, rate, budgetMinutes }) => ({ taskId, billable, rate, budgetMinutes, budgetAmount: null }))
    const fewer = await admin.put(`/projects/${id}/tasks`, { tasks: rows.slice(1) })
    const gone = (fewer.body as ProjectDetails).tasks.find(({ id: taskId }) => taskId === rows[0]?.taskId)
    expect(gone).toMatchObject({ removed: true, minutes: one.tasks[0]?.minutes })
    const back = await admin.put(`/projects/${id}/tasks`, { tasks: rows })
    expect((back.body as ProjectDetails).tasks.find(({ id: taskId }) => taskId === rows[0]?.taskId)).toMatchObject({ removed: false, rate: one.tasks[0]?.rate })
    expect(codeOf(await admin.put(`/projects/${id}/tasks`, { tasks: [rows[0], rows[0]] }))).toEqual([400, 'invalid_input'])
  })

  it('get a team, whose managers only those who may are made', async () => {
    const id = await projectId('KES-301')
    const one = await get<ProjectDetails>(admin, `/projects/${id}`)
    const members = one.people.filter(({ removed }) => !removed).map(({ id: person, isManager, rate, budgetMinutes }) => ({ personId: person, isManager, rate, budgetMinutes }))
    const owen = await personId('owen.test@jet.example')
    const more = [...members, { personId: owen, isManager: false, rate: null, budgetMinutes: null }]
    expect((await editor.put(`/projects/${id}/team`, { members: more })).status).toBe(200)
    expect(codeOf(await editor.put(`/projects/${id}/team`, { members: more.map((row) => ({ ...row, isManager: row.personId === owen ? true : row.isManager })) }))).toEqual([403, 'forbidden'])
    expect((await admin.put(`/projects/${id}/team`, { members: more.map((row) => ({ ...row, isManager: row.personId === owen ? true : row.isManager })) })).status).toBe(200)
    // Taking a manager off ends what they may do, so it takes the same.
    expect(codeOf(await editor.put(`/projects/${id}/team`, { members }))).toEqual([403, 'forbidden'])
    expect((await admin.put(`/projects/${id}/team`, { members })).status).toBe(200)
    const [row] = await database.db.select().from(projectMembers).where(and(eq(projectMembers.projectId, id), eq(projectMembers.personId, owen)))
    expect(row).toMatchObject({ isManager: false })
    expect(row?.removedAt).not.toBeNull()
    expect(codeOf(await admin.put(`/projects/${id}/team`, { members: [...members, { personId: await personId('lydia.test@jet.example'), isManager: false, rate: null, budgetMinutes: null }] }))).toEqual([409, 'not_active'])
  })

  it('are archived, restored, copied, pinned, and deleted only when empty', async () => {
    const id = await projectId('LRF-402')
    expect((await admin.post(`/projects/${id}/archive`, { archive: true })).status).toBe(200)
    expect(codeOf(await admin.put(`/projects/${id}/tasks`, { tasks: [] }))).toEqual([409, 'project_archived'])
    expect((await admin.post(`/projects/${id}/archive`, { archive: false })).status).toBe(200)
    expect(codeOf(await admin.delete(`/projects/${id}`))).toEqual([409, 'project_in_use'])
    const { clients } = await get<ProjectOptions>(admin, '/projects/options')
    const copy = (await admin.post(`/projects/${await projectId('TGW-102')}/duplicate`, { clientId: clients[0]?.id, name: 'Second round', code: 'X', withTeam: true })).body as { id: number }
    const made = await get<ProjectDetails>(admin, `/projects/${copy.id}`)
    expect(made).toMatchObject({ minutes: 0, name: 'Second round' })
    expect(made.people.length).toBeGreaterThan(1)
    expect(made.people.filter(({ isManager }) => isManager).map(({ name }) => name)).toEqual(['Avery Test'])
    await admin.post(`/projects/${copy.id}/pin`, { pin: true })
    expect((await get<{ projects: ProjectDetails[] }>(admin, '/projects')).projects[0]?.id).toBe(copy.id)
    expect(codeOf(await employee.post(`/projects/${await projectId('KES-301')}/pin`, { pin: true }))).toEqual([404, 'not_found'])
    expect((await admin.delete(`/projects/${copy.id}`)).status).toBe(200)
  })
})

describe('tasks', () => {
  it('are changed, archived and deleted', async () => {
    await admin.post('/tasks', { name: 'Grouting', billable: true, common: false, defaultRate: 9000 })
    const find = async () => (await get<{ tasks: TaskRow[] }>(admin, '/tasks')).tasks.find(({ name }) => name.startsWith('Grout'))
    const task = await find()
    expect(task).toMatchObject({ defaultRate: 9000 })
    expect((await admin.put(`/tasks/${task?.id}`, { name: 'Grouting works', billable: false, common: false, version: task?.version })).status).toBe(200)
    // Not sent, so not changed.
    expect(await find()).toMatchObject({ name: 'Grouting works', billable: false, defaultRate: 9000 })
    expect((await admin.post(`/tasks/${task?.id}/add-to-all`)).body).toMatchObject({ added: expect.any(Number) as number })
    expect(codeOf(await admin.delete(`/tasks/${task?.id}`))).toEqual([409, 'task_in_use'])
    expect((await admin.post(`/tasks/${task?.id}/archive`, { archive: true })).status).toBe(200)
  })
})

describe('people', () => {
  const details = { phone: null, kind: 'employee', weeklyCapacityMinutes: 2400, startedOn: null, notes: null, labels: ['Welder'] }

  it('are added, changed, archived, restored and deleted', async () => {
    const made = await admin.post('/people', { ...details, name: 'Wren Test', email: 'wren@jet.example', projectIds: [await projectId('TGW-101')] })
    expect(made.status).toBe(201)
    const { id } = made.body as { id: number }
    expect(codeOf(await admin.post('/people', { ...details, name: 'Copy', email: 'WREN@jet.example' }))).toEqual([400, 'invalid_input'])
    const one = await get<PersonWork>(admin, `/people/${id}/work`)
    expect(one).toMatchObject({ labels: ['Welder'], status: 'active', refusal: null })
    expect((await admin.put(`/people/${id}`, { ...details, name: 'Wren Test', email: 'wren.two@jet.example', kind: 'contractor', version: one.version })).body).toMatchObject({ email: 'wren.two@jet.example' })
    expect(codeOf(await lead.put(`/people/${id}`, {}))).toEqual([403, 'forbidden'])
    expect((await admin.post(`/people/${id}/archive`, { archive: true })).status).toBe(200)
    expect((await get<PersonWork>(admin, `/people/${id}/work`)).status).toBe('archived')
    expect((await admin.post(`/people/${id}/archive`, { archive: false })).status).toBe(200)
    expect((await admin.delete(`/people/${id}`)).status).toBe(200)
    expect(codeOf(await admin.delete(`/people/${await personId('marcus.test@jet.example')}`))).toEqual([409, 'person_in_use'])
  })

  it('who are archived are signed out, with their timer stopped', async () => {
    const options = await get<{ projects: { id: number; tasks: { id: number }[] }[] }>(employee, '/time/options')
    await employee.post('/time', { projectId: options.projects[0]?.id, taskId: options.projects[0]?.tasks[0]?.id, spentOn: today, minutes: 0, notes: '', start: true })
    clock.forward(30)
    const id = await personId('employee@jet.demo')
    expect((await admin.post(`/people/${id}/archive`, { archive: true })).status).toBe(200)
    expect(codeOf(await employee.get('/time'))).toEqual([401, 'unauthenticated'])
    await admin.post(`/people/${id}/archive`, { archive: false })
    await employee.signIn('employee@jet.demo', demoPassword)
    const week = await get<TimeWeek>(employee, '/time')
    expect(week.running).toBeNull()
    expect(week.entries.find(({ spentOn }) => spentOn === today)).toMatchObject({ minutes: 30 })
  })

  it('cannot be archived by themselves, nor by who holds less', async () => {
    expect(codeOf(await admin.post(`/people/${await personId('admin@jet.demo')}/archive`, { archive: true }))).toEqual([409, 'own_account'])
    expect(codeOf(await editor.post(`/people/${await personId('admin@jet.demo')}/archive`, { archive: true }))).toEqual([403, 'outranked'])
    expect(codeOf(await editor.delete(`/people/${await personId('lead@jet.demo')}`))).toEqual([403, 'outranked'])
    const boss = await get<PersonWork>(admin, `/people/${await personId('admin@jet.demo')}/work`)
    expect(codeOf(await editor.put(`/people/${await personId('admin@jet.demo')}`, { ...details, name: 'Avery', email: 'taken@evil.example', version: boss.version }))).toEqual([403, 'outranked'])
  })

  it('have rates, of which each kind is seen and changed only with its permission', async () => {
    const id = await personId('tomas.test@jet.example')
    const seen = await get<PersonWork>(lead, `/people/${id}/work`)
    expect([...new Set(seen.rates.map(({ kind }) => kind))]).toEqual(['billable'])
    expect((await get<PersonWork>(editor, `/people/${id}/work`)).rates).toEqual([])
    const added = await admin.post(`/people/${id}/rates`, { kind: 'cost', startsOn: '2026-12-01', rate: 5000 })
    expect(added.status).toBe(201)
    expect(codeOf(await admin.post(`/people/${id}/rates`, { kind: 'cost', startsOn: '2026-12-01', rate: 6000 }))).toEqual([400, 'invalid_input'])
    expect(codeOf(await lead.post(`/people/${id}/rates`, { kind: 'billable', startsOn: '2026-12-01', rate: 1 }))).toEqual([403, 'forbidden'])
    const rate = (added.body as PersonWork).rates.find(({ startsOn }) => startsOn === '2026-12-01')
    expect(codeOf(await editor.delete(`/people/${id}/rates/${rate?.id}`))).toEqual([403, 'forbidden'])
    expect((await admin.put(`/people/${id}/rates/${rate?.id}`, { kind: 'cost', startsOn: '2026-12-02', rate: 5100, version: rate?.version })).status).toBe(200)
    expect((await admin.delete(`/people/${id}/rates/${rate?.id}`)).status).toBe(200)
    expect(await database.db.select().from(personRates).where(and(eq(personRates.personId, id), eq(personRates.startsOn, '2026-12-02')))).toEqual([])
  })
})
