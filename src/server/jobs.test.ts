// What the server does by itself, email, reports and export, over the demo company.
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxRow } from '../shared/notifications'
import type { DetailedTime, ExpenseReport, PaymentReport, TimeReport } from '../shared/work'
import { createContext } from './app'
import type { AppContext } from './context'
import { loadConfig } from './config'
import type { Database } from './db'
import { budgetAlerts, companySettings, invoiceReminders, invoices, jobRuns, notifications, outboxMessages, people, projects } from './db/schema'
import { demoPassword } from './demo/accounts'
import { seedDemo } from './demo'
import { smtpSender } from './email/smtp'
import { remindLateInvoices, remindTimesheets, runDueJobs, startJobs } from './jobs'
import { type Browser, signedIn, standInSender, testApp, testClock } from './testing/apiClient'
import { createTestDatabase } from './testing/testDatabase'
import { noteBudgetAlerts } from './work/budgets'

const today = '2026-11-24'
// 10:00 in Chicago.
const clock = testClock('2026-11-24T16:00:00Z')
const { sender, messages } = standInSender()
let database: Database
let ctx: AppContext
let admin: Browser
let lead: Browser
let employee: Browser
beforeAll(async () => {
  database = await createTestDatabase()
  await seedDemo(database.db, { today })
  ctx = createContext({ db: database.db, basePath: '/', now: clock.now, email: sender })
  const app = testApp({ db: database.db, now: clock.now, email: sender })
  admin = await signedIn(app, 'admin@jet.demo', demoPassword)
  lead = await signedIn(app, 'lead@jet.demo', demoPassword)
  employee = await signedIn(app, 'employee@jet.demo', demoPassword)
}, 60_000)
afterAll(() => database.close())
beforeEach(() => {
  messages.length = 0
})

describe('jobs', () => {
  it('run once a day, also when two servers look at the same time, and again after a failure', async () => {
    const ran = await Promise.all([runDueJobs(ctx), runDueJobs(ctx)])
    expect(ran.flat().sort()).toEqual(['budget_alerts', 'invoice_reminders', 'recurring_invoices', 'timesheet_reminders'])
    expect(await runDueJobs(ctx)).toEqual([])
    await database.db.update(jobRuns).set({ status: 'failed' }).where(eq(jobRuns.job, 'budget_alerts'))
    expect(await runDueJobs(ctx)).toEqual(['budget_alerts'])
    await database.db.update(jobRuns).set({ status: 'failed', attempts: 3 }).where(eq(jobRuns.job, 'budget_alerts'))
    expect(await runDueJobs(ctx)).toEqual([])
  })

  it('wait for their time of day', async () => {
    const early = { ...ctx, now: () => new Date('2026-11-25T12:30:00Z') }
    expect(await runDueJobs(early)).toEqual(['recurring_invoices'])
  })

  it('remind of a late invoice once for each day that is set, and leave out what was missed', async () => {
    await database.db.delete(invoiceReminders)
    await database.db.update(companySettings).set({ reminderDays: [3, 14, 30] })
    const late = (await database.db.select().from(invoices).where(eq(invoices.status, 'open'))).filter(({ dueOn }) => dueOn < '2026-11-21')
    expect(late.length).toBeGreaterThan(1)
    await remindLateInvoices(ctx, today)
    const sent = await database.db.select().from(invoiceReminders).where(eq(invoiceReminders.status, 'sent'))
    expect(new Set(sent.map(({ invoiceId }) => invoiceId)).size).toBe(sent.length)
    expect(messages.filter(({ kind }) => kind === 'invoice_reminder').length).toBeGreaterThan(0)
    messages.length = 0
    await remindLateInvoices(ctx, today)
    expect(messages).toEqual([])
  })

  it('remind of a week that was not submitted, three days after it', async () => {
    // Monday, with weeks from Saturday.
    expect(await remindTimesheets(ctx, '2026-11-24')).toBe(0)
    expect(await remindTimesheets(ctx, '2026-11-23')).toBeGreaterThan(0)
    expect(messages.every(({ subject }) => subject === 'Please submit your week')).toBe(true)
  })

  it('tell of a budget once', async () => {
    await database.db.delete(budgetAlerts)
    await database.db.delete(notifications)
    expect(await noteBudgetAlerts(ctx)).toBeGreaterThan(0)
    const told = await database.db.select().from(notifications).where(eq(notifications.kind, 'budget'))
    expect(told.length).toBeGreaterThan(0)
    expect(await noteBudgetAlerts(ctx)).toBe(0)
    const [employeeRow] = await database.db.select().from(people).where(eq(people.email, 'employee@jet.demo'))
    expect(told.some(({ personId }) => personId === employeeRow?.id)).toBe(false)
    expect((await database.db.select().from(projects)).length).toBeGreaterThan(told.length)
  })

  it('stop with the server', async () => {
    const stop = startJobs(ctx)
    await stop()
  })
})

describe('email', () => {
  const smtp = { url: 'smtp://user:secret@127.0.0.1:2525', from: 'Time <time@example.com>' }
  const message = { kind: 'test', to: { name: 'Pat', email: 'pat@client.example' }, subject: 'Hello', body: 'Text' }
  const stored = (subject: string) => database.db.select().from(outboxMessages).where(eq(outboxMessages.subject, subject))

  it('is sent, and kept with how it went', async () => {
    const sent: unknown[] = []
    await smtpSender(database.db, smtp, (mail) => Promise.resolve(sent.push(mail))).send({ ...message, subject: 'Good' })
    expect(sent).toEqual([{ from: smtp.from, to: { name: 'Pat', address: 'pat@client.example' }, subject: 'Good', text: 'Text' }])
    expect(await stored('Good')).toMatchObject([{ status: 'sent', attempts: 1, error: null }])
  })

  it('that fails is tried again, but not with a link, which is not kept', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let broken = true
    const texts: string[] = []
    const sender2 = smtpSender(database.db, smtp, ({ text }) => {
      texts.push(text)
      return broken ? Promise.reject(new Error('no answer')) : Promise.resolve()
    })
    await sender2.send({ ...message, subject: 'Plain' })
    await sender2.send({ ...message, subject: 'Linked', body: 'See {link}', link: 'https://time.example.com/client/invoice#secret' })
    expect(await stored('Plain')).toMatchObject([{ status: 'failed', error: 'no answer' }])
    expect((await stored('Linked'))[0]?.body).toBe('See [link hidden]')
    broken = false
    texts.length = 0
    expect(await sender2.retry()).toBe(1)
    expect(texts).toEqual(['Text'])
    expect(await stored('Plain')).toMatchObject([{ status: 'sent', attempts: 2 }])
    vi.restoreAllMocks()
  })

  it('is seen in the Outbox by those who may', async () => {
    const { messages: rows } = (await admin.get('/outbox?search=Good')).body as { messages: OutboxRow[] }
    expect(rows).toMatchObject([{ subject: 'Good', status: 'sent' }])
    for (const client of [lead, employee]) expect((await client.get('/outbox')).status).toBe(403)
  })

  it('is set up by SMTP_URL and EMAIL_FROM, whose password is never repeated, and not for a demo', () => {
    const env = { PUBLIC_URL: 'https://time.example.com/', DATABASE_URL: 'postgres://x/y', SMTP_URL: smtp.url, EMAIL_FROM: smtp.from }
    expect(loadConfig([], env).smtp).toEqual(smtp)
    expect(loadConfig(['--demo'], { SMTP_URL: smtp.url, EMAIL_FROM: smtp.from }).smtp).toBeNull()
    expect(loadConfig([], { ...env, SMTP_URL: '' }).smtp).toBeNull()
    expect(() => loadConfig([], { ...env, EMAIL_FROM: '' })).toThrow('EMAIL_FROM')
    const wrong = () => loadConfig([], { ...env, SMTP_URL: 'http://user:secret@mail' })
    expect(wrong).toThrow('SMTP_URL')
    expect(wrong).not.toThrow('secret')
    expect(() => loadConfig([], { ...env, EMAIL_FROM: 'x@example.com>\r\nBcc: y@example.com' })).toThrow('EMAIL_FROM')
  })
})

describe('reports', () => {
  const range = 'from=2026-09-01&to=2026-11-24'
  const read = async <T>(client: Browser, what: string) => (await client.get(`/reports/${what}?${range}`)).body as T

  it('agree with each other, and show only what one may see', async () => {
    const total = await read<TimeReport>(admin, 'time')
    const detail = await read<DetailedTime>(admin, 'detailed')
    expect(detail.rows.reduce((sum, { minutes }) => sum + minutes, 0)).toBe(total.minutes)
    const mine = await read<DetailedTime>(employee, 'detailed')
    expect(new Set(mine.rows.map(({ person }) => person))).toEqual(new Set(['Casey Test']))
    expect(mine.rows.every(({ amount }) => amount === null)).toBe(true)
    expect((await read<DetailedTime>(lead, 'detailed')).rows.length).toBeLessThan(detail.rows.length)
    const spent = await read<ExpenseReport>(employee, 'expenses')
    expect(spent.rows.every(({ person }) => person === 'Casey Test')).toBe(true)
    expect((await read<ExpenseReport>(admin, 'expenses')).rows.length).toBeGreaterThan(spent.rows.length)
    expect((await read<PaymentReport>(admin, 'payments')).rows.length).toBeGreaterThan(0)
    expect((await lead.get(`/reports/payments?${range}`)).status).toBe(403)
    expect((await admin.get('/reports/detailed?from=2026-11-24&to=2026-01-01')).status).toBe(400)
  })
})

describe('export', () => {
  it('is for administrators, has every entry, and no passwords', async () => {
    const { tables } = (await admin.get('/export')).body as { tables: string[] }
    for (const name of tables) {
      const { rows } = (await admin.get(`/export/${encodeURIComponent(name)}`)).body as { rows: unknown[][] }
      expect(rows.length, name).toBeGreaterThan(1)
      expect(rows.every((row) => row.length === rows[0]?.length), name).toBe(true)
      expect(JSON.stringify(rows)).not.toMatch(/\$argon|scrypt|passwordHash/)
    }
    expect((await admin.get('/export/__proto__')).status).toBe(404)
    for (const client of [lead, employee]) expect((await client.get('/export/time')).status).toBe(403)
    expect(await database.db.$count(jobRuns, and(eq(jobRuns.status, 'running')))).toBe(0)
  })
})
