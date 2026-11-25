// Submitting and approving weeks, expenses with receipts, and notifications, over the demo company.
import { and, eq, inArray } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NotificationList } from '../../shared/notifications'
import type { Approvals, CompanySettings, ExpenseOptions, ExpenseRow, TeamExpense, TimeOptions, TimeWeek } from '../../shared/work'
import { createApp } from '../app'
import type { Database } from '../db'
import { approvalEvents, expenses, files, notifications, people, submissions, timeEntries } from '../db/schema'
import { demoPassword } from '../demo/accounts'
import { seedDemo } from '../demo'
import { type Browser, signedIn, standInSender, testApp, testClock } from '../testing/apiClient'
import { createTestDatabase } from '../testing/testDatabase'

const clock = testClock('2026-11-24T16:00:00Z')
const { sender, messages } = standInSender()
let database: Database
let app: ReturnType<typeof createApp>
let admin: Browser
let lead: Browser
let employee: Browser
let employeeId: number
beforeAll(async () => {
  database = await createTestDatabase()
  await seedDemo(database.db, { today: '2026-11-24' })
  app = testApp({ db: database.db, now: clock.now, email: sender })
  admin = await signedIn(app, 'admin@jet.demo', demoPassword)
  lead = await signedIn(app, 'lead@jet.demo', demoPassword)
  employee = await signedIn(app, 'employee@jet.demo', demoPassword)
  employeeId = (await database.db.select().from(people).where(eq(people.email, 'employee@jet.demo')))[0]?.id ?? 0
}, 60_000)
afterAll(() => database.close())

async function get<T>(client: Browser, path: string): Promise<T> {
  const response = await client.get(path)
  expect(response.status, path).toBe(200)
  return response.body as T
}
const codeOf = (response: { status: number; body: unknown }) => [response.status, (response.body as { error?: { code: string } }).error?.code]
/** A week nobody seeded anything for. */
const free = '2027-03-06'
const firstTask = async (client: Browser) => {
  const { projects } = await get<TimeOptions>(client, '/time/options')
  const [project] = projects
  return { projectId: project?.id ?? 0, taskId: project?.tasks[0]?.id ?? 0 }
}
const entry = async (spentOn: string, more: object = {}) => ({ ...(await firstTask(employee)), spentOn, minutes: 90, startMinute: null, endMinute: null, notes: '', ...more })
const unread = async (client: Browser) => (await get<NotificationList>(client, '/notifications')).rows.filter(({ read }) => !read).map(({ title }) => title)

describe('entering time', () => {
  it('takes start and end, and works out the hours', async () => {
    const answer = await employee.post('/time', await entry('2027-01-04', { startMinute: 510, endMinute: 975 }))
    expect((answer.body as TimeWeek).entries[0]).toMatchObject({ minutes: 465, startMinute: 510, endMinute: 975 })
    expect(codeOf(await employee.post('/time', await entry('2027-01-04', { startMinute: 510 })))).toEqual([400, 'invalid_input'])
    expect(codeOf(await employee.post('/time', await entry('2027-01-04', { startMinute: 510, endMinute: 500 })))).toEqual([400, 'invalid_input'])
    const month = await get<{ days: { day: string; minutes: number }[] }>(employee, '/time/month?month=2027-01')
    expect(month.days).toEqual([{ day: '2027-01-04', minutes: 465 }])
  })

  it('keeps favorites for the person alone', async () => {
    const what = await firstTask(employee)
    const added = (await employee.post('/time/favorites', { ...what, notes: '' })).body as TimeOptions
    const one = added.favorites.find(({ projectId }) => projectId === what.projectId)
    expect(one).toMatchObject(what)
    expect((await get<TimeOptions>(lead, '/time/options')).favorites.map(({ id }) => id)).not.toContain(one?.id)
    const id = one?.id
    await lead.delete(`/time/favorites/${id}`)
    const { favorites } = await get<TimeOptions>(employee, '/time/options')
    expect(favorites).toHaveLength(added.favorites.length)
    expect(((await employee.delete(`/time/favorites/${id}`)).body as TimeOptions).favorites).toHaveLength(favorites.length - 1)
  })

  it('for someone else is for those who may, and only on their projects', async () => {
    const body = { ...(await entry('2027-01-05')), personId: employeeId }
    expect((await admin.post('/time', body)).body).toMatchObject({ own: false, person: { id: employeeId }, entries: [{ minutes: 465 }, { minutes: 90 }] })
    expect((await get<TimeWeek>(employee, '/time?date=2027-01-05')).entries).toHaveLength(2)
    const other = (await database.db.select().from(people).where(eq(people.email, 'admin@jet.demo')))[0]?.id ?? 0
    expect(codeOf(await employee.post('/time', { ...body, personId: other }))[0]).toBeGreaterThanOrEqual(403)
    expect(codeOf(await employee.get(`/time?person=${other}`))).toEqual([403, 'forbidden'])
    expect((await get<TimeWeek>(employee, '/time')).people).toEqual([])
  })

  it('needs notes where the company wants them', async () => {
    const { version, logoFileId: _logo, ...settings } = await get<CompanySettings>(admin, '/settings')
    await admin.put('/settings', { ...settings, timeNotesRequired: true, version })
    expect(codeOf(await employee.post('/time', await entry('2027-01-06')))).toEqual([400, 'invalid_input'])
    expect((await employee.post('/time', await entry('2027-01-06', { notes: 'Drawings' }))).status).toBe(201)
    await admin.put('/settings', { ...settings, version: version + 1 })
  })
})

describe('a week', () => {
  const submit = async (day: string) => {
    expect((await employee.post('/time', await entry(day))).status).toBe(201)
    expect((await employee.post('/time/submit', { date: day })).status).toBe(200)
    const found = (await get<Approvals>(admin, `/approvals?from=${day}&to=${day}`)).pending.find(({ person, from, to }) => person.id === employeeId && day >= from && day <= to)
    expect(found).toBeDefined()
    return found?.submissionId ?? 0
  }

  it('is approved, which tells its owner and locks it, and can be opened again', async () => {
    const id = await submit(free)
    expect(codeOf(await employee.get(`/approvals?from=${free}&to=${free}`))).toEqual([403, 'forbidden'])
    expect(codeOf(await employee.post(`/approvals/${id}/approve`))).toEqual([403, 'forbidden'])
    expect((await admin.post(`/approvals/${id}/approve`)).status).toBe(200)
    expect(codeOf(await admin.post(`/approvals/${id}/approve`))).toEqual([409, 'already_handled'])
    const week = await get<TimeWeek>(employee, `/time?date=${free}`)
    expect(week).toMatchObject({ submission: { status: 'approved' }, entries: [{ status: 'approved', locked: 'approved' }] })
    expect(await unread(employee)).toContain('Your week was approved')
    const entryId = week.entries[0]?.id
    expect(codeOf(await employee.post(`/time/${entryId}/delete`, { version: week.entries[0]?.version }))).toEqual([409, 'locked'])

    expect(codeOf(await lead.post(`/approvals/${id}/reopen`))[0]).toBe(403)
    expect((await admin.post(`/approvals/${id}/reopen`)).status).toBe(200)
    const reopened = await get<TimeWeek>(employee, `/time?date=${free}`)
    expect(reopened).toMatchObject({ submission: null, entries: [{ status: 'unsubmitted', locked: null }] })
    expect((await employee.post('/time/submit', { date: free })).status).toBe(200)
  })

  it('is sent back with a comment, changed and submitted again', async () => {
    const day = '2027-03-15'
    const id = await submit(day)
    messages.length = 0
    expect((await admin.post(`/approvals/${id}/reject`, { comment: 'Which pump?' })).status).toBe(200)
    expect(messages.map(({ subject, text }) => [subject, text.includes('Which pump?')])).toEqual([['Your week was sent back', true]])
    const week = await get<TimeWeek>(employee, `/time?date=${day}`)
    expect(week).toMatchObject({ submission: { status: 'rejected', comment: 'Which pump?' }, entries: [{ status: 'rejected', locked: null }] })
    const [first] = week.entries
    expect((await employee.put(`/time/${first?.id}`, { ...(await entry(day, { notes: 'Pump 2' })), version: first?.version })).status).toBe(200)
    expect((await employee.post('/time/submit', { date: day })).status).toBe(200)
    expect((await admin.post(`/approvals/${id}/approve`)).status).toBe(200)
  })

  it('is approved once when two approve at the same time', async () => {
    const id = await submit('2027-03-22')
    const answers = await Promise.all([admin.post(`/approvals/${id}/approve`), admin.post(`/approvals/${id}/approve`)])
    expect(answers.map(({ status }) => status).sort()).toEqual([200, 409])
  })

  it('locked by date can be unlocked for one person', async () => {
    const { version, logoFileId: _logo, ...settings } = await get<CompanySettings>(admin, '/settings')
    await admin.put('/settings', { ...settings, lockedThrough: '2026-08-31', version })
    expect(codeOf(await employee.post('/time', await entry('2026-03-04')))).toEqual([409, 'period_closed'])
    expect(codeOf(await lead.post('/approvals/unlock', { personId: employeeId, date: '2026-03-04' }))[0]).toBe(403)
    expect((await admin.post('/approvals/unlock', { personId: employeeId, date: '2026-03-04' })).status).toBe(200)
    expect((await employee.post('/time', await entry('2026-03-04'))).status).toBe(201)
    expect(codeOf(await employee.post('/time', await entry('2026-03-14')))).toEqual([409, 'period_closed'])
    await admin.put('/settings', { ...settings, version: version + 1 })
  })

  it('that is missing can be asked for', async () => {
    const { people: team } = await get<Approvals>(admin, '/approvals?from=2026-11-14&to=2026-11-20')
    expect(team.find(({ name }) => name === 'Dana Test')).toMatchObject({ missing: true, canSubmit: true, canRemind: true })
    expect((await admin.post('/approvals/remind', { personIds: [employeeId], date: '2026-11-14' })).body).toEqual({ reminded: 1 })
    expect(await unread(employee)).toContain('Please submit your week')
  })
})

describe('a period of approvals', () => {
  // The week before the demo's today.
  const last = 'from=2026-11-14&to=2026-11-20'
  const period = { from: '2026-11-14', to: '2026-11-20' }
  const read = (client: Browser) => get<Approvals>(client, `/approvals?${last}`)
  const idOf = (data: Approvals, name: string) => data.people.find((person) => person.name === name)?.id ?? 0

  it('has the time and expenses of everyone one decides about, by status', async () => {
    const data = await read(admin)
    const entries = await database.db.select().from(timeEntries)
    const mine = entries.filter(({ spentOn }) => spentOn >= period.from && spentOn <= period.to)
    expect(data.lines.reduce((sum, { minutes }) => sum + minutes, 0)).toBe(mine.reduce((sum, { minutes }) => sum + minutes, 0))
    const statusOf = (name: string) => [...new Set(data.lines.filter(({ personId }) => personId === idOf(data, name)).map(({ status }) => status))]
    expect([statusOf('Dana Test'), statusOf('Owen Test'), statusOf('Marcus Test'), statusOf('Priya Test')]).toEqual([['open'], ['open'], ['submitted'], ['approved']])
    expect(data.pending.map(({ person }) => person.name)).toEqual(['Marcus Test', 'Tomas Test'])
    expect(data).toMatchObject({ canLock: true, canUnlock: true, reminder: { weekday: 5, minute: 1020 } })
    expect(data.people.find(({ name }) => name === 'Dana Test')?.department).toBe('Field services')

    const led = await read(lead)
    expect(led.lines.length).toBeLessThan(data.lines.length)
    expect(led.people.map(({ name }) => name)).not.toContain('Jordan Test')
    expect(led).toMatchObject({ canLock: false, canUnlock: false })
    expect((await get<Approvals>(admin, '/approvals?from=2026-10-01&to=2026-10-02')).elsewhere).toContainEqual({ ...period, count: 2 })
    expect(codeOf(await admin.get('/approvals?from=2020-01-01&to=2026-01-01'))).toEqual([400, 'invalid_input'])
  })

  it('can be submitted for people, which tells them, only by those who decide about them', async () => {
    const dana = idOf(await read(admin), 'Dana Test')
    const body = { personIds: [dana], ...period }
    expect(codeOf(await employee.post('/approvals/submit', body))).toEqual([403, 'forbidden'])
    // Dana is on none of the lead's projects and is not managed by the lead.
    expect(codeOf(await lead.post('/approvals/submit', body))).toEqual([404, 'not_found'])
    messages.length = 0
    expect((await admin.post('/approvals/submit', body)).body).toEqual({ submitted: 1, refused: [] })
    expect((await admin.post('/approvals/submit', body)).body).toEqual({ submitted: 0, refused: [] })
    const told = await database.db.select().from(notifications).where(and(eq(notifications.personId, dana), eq(notifications.kind, 'submitted_for')))
    expect(told).toHaveLength(1)
    const after = await read(admin)
    expect(after.people.find(({ id }) => id === dana)).toMatchObject({ missing: false, canSubmit: false })
    expect(after.pending.map(({ person }) => person.name)).toContain('Dana Test')
    const [event] = await database.db.select({ actorId: approvalEvents.actorId }).from(approvalEvents).innerJoin(submissions, eq(submissions.id, approvalEvents.submissionId)).where(and(eq(submissions.personId, dana), eq(submissions.periodStart, period.from)))
    expect(event?.actorId).toBe(idOf(after, 'Avery Test'))
  })

  it('is submitted once when two do it at the same time', async () => {
    const owen = idOf(await read(admin), 'Owen Test')
    const body = { personIds: [owen], ...period }
    const answers = await Promise.all([admin.post('/approvals/submit', body), admin.post('/approvals/submit', body)])
    expect(answers.map(({ body: answer }) => (answer as { submitted: number }).submitted).sort()).toEqual([0, 1])
  })

  it('is approved for several at once, and those that were decided meanwhile are left out', async () => {
    const ids = (await read(admin)).pending.map(({ submissionId }) => submissionId)
    expect(codeOf(await employee.post('/approvals/approve', { ids }))).toEqual([403, 'forbidden'])
    expect((await admin.post(`/approvals/${ids[0]}/approve`)).status).toBe(200)
    expect((await admin.post('/approvals/approve', { ids })).body).toEqual({ approved: ids.length - 1 })
    expect((await read(admin)).pending).toEqual([])
  })

  it('is locked by a date, by those who may, and never unlocked by that', async () => {
    const before = await get<CompanySettings>(admin, '/settings')
    expect(codeOf(await lead.post('/approvals/lock', { through: '2026-08-31' }))[0]).toBe(403)
    expect((await admin.post('/approvals/lock', { through: '2026-08-31' })).status).toBe(200)
    expect(codeOf(await admin.post('/approvals/lock', { through: '2026-07-31' }))).toEqual([409, 'already_locked'])
    expect(codeOf(await employee.post('/time', await entry('2026-08-05')))).toEqual([409, 'period_closed'])
    expect((await read(admin)).lock).toEqual({ through: '2026-08-31', afterDays: null })
    const { version, logoFileId: _logo, ...settings } = await get<CompanySettings>(admin, '/settings')
    // Who had the settings open does not overwrite the lock.
    expect(version).toBeGreaterThan(before.version)
    await admin.put('/settings', { ...settings, lockedThrough: null, version })
  })
})

describe('notifications', () => {
  it('are read, and not sent where they are not wanted', async () => {
    const { rows } = await get<NotificationList>(employee, '/notifications')
    expect((await lead.post('/notifications/read', { id: rows[0]?.id })).status).toBe(200)
    expect((await get<NotificationList>(employee, '/notifications')).unread).toBe(rows.filter(({ read }) => !read).length)
    expect(((await employee.post('/notifications/read', { id: null })).body as NotificationList).unread).toBe(0)
    const saved = await employee.put('/notifications/preferences', { kind: 'timesheet_reminder', inApp: false, email: false })
    expect(saved.status).toBe(200)
    messages.length = 0
    await admin.post('/approvals/remind', { personIds: [employeeId], date: '2026-11-14' })
    expect([await unread(employee), messages]).toEqual([[], []])
  })
})

// The smallest PNG there is.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

describe('expenses', () => {
  const upload = (client: Browser, path: string, content: Buffer) =>
    request(app).put(`/api${path}`).set('Cookie', client.cookie ?? '').set('X-CSRF-Token', client.csrfToken ?? '').set('Content-Type', 'application/octet-stream').send(content)
  const add = async () => {
    const { projects, categories } = await get<ExpenseOptions>(employee, '/expenses/options')
    const body = {
      projectId: projects[0]?.id, categoryId: categories.find(({ unitName }) => unitName === null)?.id, spentOn: '2027-05-04', amount: 4250, quantity: null, notes: '', billable: true,
      reimbursable: true,
    }
    const made = (await employee.post('/expenses', body)).body as { id: number; expenses: ExpenseRow[] }
    return made.expenses.find(({ id }) => id === made.id) as ExpenseRow
  }

  it('have receipts, which only those who see the expense can open', async () => {
    const row = await add()
    const path = `/expenses/${row.id}/receipts/${row.version}`
    expect(codeOf(await upload(employee, path, Buffer.from('<html>')))).toEqual([400, 'bad_file'])
    const answer = await upload(employee, path, png)
    expect(answer.status).toBe(200)
    const [receipt] = (answer.body as { expenses: ExpenseRow[] }).expenses.find(({ id }) => id === row.id)?.receipts ?? []
    const file = await employee.get(`/expenses/${row.id}/receipts/${receipt?.id}`)
    expect([file.status, file.get('Content-Type'), file.get('X-Content-Type-Options')]).toEqual([200, 'image/png', 'nosniff'])
    const pdf = await upload(employee, `/expenses/${row.id}/receipts/${(answer.body as { expenses: ExpenseRow[] }).expenses.find(({ id }) => id === row.id)?.version}`, Buffer.from('%PDF-1.4 test'))
    const second = (pdf.body as { expenses: ExpenseRow[] }).expenses.find(({ id }) => id === row.id)?.receipts[1]
    expect((await employee.get(`/expenses/${row.id}/receipts/${second?.id}`)).get('Content-Disposition')).toMatch(/^attachment/)

    const other = await signedIn(app, 'admin@jet.demo', demoPassword)
    expect((await other.get(`/expenses/${row.id}/receipts/${receipt?.id}`)).status).toBe(200)
    expect(codeOf(await employee.get(`/expenses/${row.id + 100_000}/receipts/${receipt?.id}`))).toEqual([404, 'not_found'])
    const now = (await get<{ expenses: ExpenseRow[] }>(employee, '/expenses')).expenses.find(({ id }) => id === row.id)
    await employee.post(`/expenses/${row.id}/delete`, { version: now?.version })
    expect(await database.db.select({ id: files.id }).from(files).where(inArray(files.id, [receipt?.id ?? 0, second?.id ?? 0]))).toEqual([])
  })

  it('are paid back once approved, and only then', async () => {
    const row = await add()
    const body = { ids: [row.id], paidOn: '2027-05-20' }
    expect(codeOf(await lead.post('/expenses/reimburse', body))[0]).toBe(403)
    expect(codeOf(await admin.post('/expenses/reimburse', body))).toEqual([409, 'already_handled'])
    await employee.post('/time/submit', { date: '2027-05-04' })
    const [submission] = await database.db.select().from(submissions).where(and(eq(submissions.personId, employeeId), eq(submissions.status, 'submitted'), eq(submissions.periodStart, '2027-05-01')))
    expect((await admin.post(`/approvals/${submission?.id}/approve`)).status).toBe(200)
    expect((await admin.post('/expenses/reimburse', body)).body).toEqual({ changed: 1 })
    expect(codeOf(await admin.post('/expenses/reimburse', body))).toEqual([409, 'already_handled'])
    const { expenses: team } = await get<{ expenses: TeamExpense[] }>(admin, '/expenses/team?from=2027-05-01&to=2027-05-31')
    expect(team).toMatchObject([{ id: row.id, person: { id: employeeId }, reimbursementStatus: 'paid' }])
    expect(codeOf(await employee.get('/expenses/team?from=2027-05-01&to=2027-05-31'))).toEqual([403, 'forbidden'])
    // A week whose expense was paid back opens again without that expense.
    expect((await admin.post(`/approvals/${submission?.id}/reopen`)).status).toBe(200)
    expect((await database.db.select().from(expenses).where(eq(expenses.id, row.id)))[0]).toMatchObject({ status: 'approved', reimbursementStatus: 'paid' })
  })

  it('have categories, which are managed', async () => {
    const category = { name: 'Boat rental', unitName: null, unitPrice: null, version: null }
    expect(codeOf(await employee.post('/expense-categories', category))).toEqual([403, 'forbidden'])
    const made = (await admin.post('/expense-categories', category)).body as { categories: { id: number; version: number; name: string }[] }
    const one = made.categories.find(({ name }) => name === 'Boat rental')
    expect(codeOf(await admin.post('/expense-categories', { ...category, name: 'boat RENTAL' }))).toEqual([400, 'invalid_input'])
    expect(codeOf(await admin.put(`/expense-categories/${one?.id}`, { ...category, unitName: 'hour', version: one?.version }))).toEqual([400, 'invalid_input'])
    expect((await admin.put(`/expense-categories/${one?.id}`, { ...category, unitName: 'hour', unitPrice: 6_000_000, version: one?.version })).status).toBe(200)
    await admin.post(`/expense-categories/${one?.id}/archive`, { archive: true })
    expect((await get<ExpenseOptions>(employee, '/expenses/options')).categories.map(({ name }) => name)).not.toContain('Boat rental')
  })
})

it('leaves nothing waiting in a week that was decided', async () => {
  const decided = await database.db.select().from(submissions).where(eq(submissions.status, 'approved'))
  const waiting = await database.db.select().from(timeEntries).where(eq(timeEntries.status, 'submitted'))
  for (const { personId, periodStart, periodEnd } of decided) {
    expect(waiting.filter((row) => row.personId === personId && row.spentOn >= periodStart && row.spentOn <= periodEnd)).toEqual([])
  }
})
