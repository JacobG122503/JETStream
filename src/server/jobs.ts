/** What the server does by itself at set times. Each due run happens once, also with several servers and after restarts. */
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import { remindersDue } from '../shared/calc'
import { addDays, type IsoDate, startOfWeek, type Weekday, weekdayOf } from '../shared/dates'
import { instantAt, todayIn } from './clock'
import type { AppContext } from './context'
import { invoiceReminders, invoices, jobRuns, people, projectMembers, submissions } from './db/schema'
import { describeError, withTimeout } from './errors'
import type { SmtpSender } from './email/smtp'
import { getSettings } from './people/lookup'
import { isCurrentMembership } from './people/membership'
import { defaultMessage, sendMessage } from './work/invoiceWork'
import { notify } from './work/notify'
import { noteBudgetAlerts } from './work/budgets'
import { makeDueInvoices } from './work/recurring'
import { formatDate } from './work/text'

interface Job {
  name: string
  /** Minutes after midnight, in the company's time zone. */
  at: number | ((settings: Awaited<ReturnType<typeof getSettings>>) => number)
  run: (ctx: AppContext, today: IsoDate) => Promise<unknown>
}

const jobs: Job[] = [
  { name: 'recurring_invoices', at: 5 * 60, run: (ctx) => makeDueInvoices(ctx) },
  { name: 'invoice_reminders', at: 8 * 60, run: (ctx, today) => remindLateInvoices(ctx, today) },
  { name: 'timesheet_reminders', at: ({ reminderMinute }) => reminderMinute, run: (ctx, today) => remindTimesheets(ctx, today) },
  { name: 'budget_alerts', at: 7 * 60, run: (ctx) => noteBudgetAlerts(ctx) },
]

const mostAttempts = 3
/** A run that began so long ago and did not end was cut off. */
const cutOffMs = 30 * 60_000

/** Runs what is due today and was not run yet. */
export async function runDueJobs(ctx: AppContext): Promise<string[]> {
  const settings = await getSettings(ctx.db)
  const { timeZone } = settings
  const now = ctx.now()
  const today = todayIn(timeZone, now)
  const ran: string[] = []
  for (const { name, at, run } of jobs) {
    const dueAt = instantAt(today, typeof at === 'number' ? at : at(settings), timeZone)
    if (now < dueAt || !(await claim(ctx, name, dueAt))) continue
    const mine = and(eq(jobRuns.job, name), eq(jobRuns.dueAt, dueAt))
    try {
      await run(ctx, today)
      await ctx.db.update(jobRuns).set({ status: 'succeeded', finishedAt: ctx.now(), error: null }).where(mine)
    } catch (error) {
      console.error(`The job ${name} failed.\n${describeError(error)}`)
      await ctx.db.update(jobRuns).set({ status: 'failed', finishedAt: ctx.now(), error: 'It failed. See the log of the server.' }).where(mine)
    }
    ran.push(name)
  }
  return ran
}

/** Whether this server is to do the run. */
async function claim({ db, now }: AppContext, job: string, dueAt: Date): Promise<boolean> {
  const [first] = await db.insert(jobRuns).values({ job, dueAt, status: 'running', startedAt: now() }).onConflictDoNothing().returning({ id: jobRuns.id })
  if (first) return true
  const [last] = await db.select().from(jobRuns).where(and(eq(jobRuns.job, job), eq(jobRuns.dueAt, dueAt)))
  if (!last || last.attempts >= mostAttempts) return false
  const cutOff = last.status === 'running' && last.startedAt.getTime() < now().getTime() - cutOffMs
  if (last.status !== 'failed' && !cutOff) return false
  const [again] = await db
    .update(jobRuns)
    .set({ status: 'running', attempts: last.attempts + 1, startedAt: now() })
    .where(and(eq(jobRuns.id, last.id), eq(jobRuns.attempts, last.attempts)))
    .returning({ id: jobRuns.id })
  return again !== undefined
}

/** The latest reminder that is due for each late invoice; earlier ones that were missed are left out. */
export async function remindLateInvoices(ctx: AppContext, today: IsoDate): Promise<number> {
  const { reminderDays } = await getSettings(ctx.db)
  if (reminderDays.length === 0) return 0
  const late = await ctx.db.select().from(invoices).where(and(eq(invoices.status, 'open'), lt(invoices.dueOn, today), isNotNull(invoices.sentAt)))
  let sent = 0
  for (const invoice of late) {
    const due = remindersDue(invoice.dueOn, reminderDays, today)
    const latest = due.at(-1)
    if (latest === undefined) continue
    const known = await ctx.db.select({ on: invoiceReminders.remindOn }).from(invoiceReminders).where(eq(invoiceReminders.invoiceId, invoice.id))
    const open = due.filter((date) => !known.some(({ on }) => on === date))
    if (!open.includes(latest)) continue
    for (const date of open) {
      await ctx.db.insert(invoiceReminders).values({ invoiceId: invoice.id, remindOn: date, status: date === latest ? 'scheduled' : 'skipped' }).onConflictDoNothing()
    }
    const message = await defaultMessage(ctx.db, invoice, 'reminder')
    const mine = and(eq(invoiceReminders.invoiceId, invoice.id), eq(invoiceReminders.remindOn, latest))
    if (message.recipients.length > 0) {
      await sendMessage(ctx, null, invoice.id, null, { kind: 'reminder', ...message })
      await ctx.db.update(invoiceReminders).set({ status: 'sent', sentAt: ctx.now() }).where(mine)
      sent++
    } else await ctx.db.update(invoiceReminders).set({ status: 'skipped' }).where(mine)
    await notify(ctx, [invoice.createdBy], {
      kind: 'invoice_late', title: `Invoice ${invoice.number} is late`, path: `/invoices/${invoice.id}`,
      body: `It was due on ${formatDate(invoice.dueOn)}. ${message.recipients.length > 0 ? 'A reminder was made for the client.' : 'The client has no contact to remind.'}`,
    })
  }
  return sent
}

/** The week to submit on a date: this week towards its end, and the one before at its beginning. */
export function weekToSubmit(today: IsoDate, weekStart: Weekday): IsoDate {
  const thisWeek = startOfWeek(today, weekStart)
  return today >= addDays(thisWeek, 4) ? thisWeek : addDays(thisWeek, -7)
}

/** On the weekday the company chose, whoever is on a project and did not submit the week is reminded. */
export async function remindTimesheets(ctx: AppContext, today: IsoDate): Promise<number> {
  const { approvalEnabled, weekStartsOn, reminderWeekday } = await getSettings(ctx.db)
  if (!approvalEnabled || weekdayOf(today) !== reminderWeekday) return 0
  const from = weekToSubmit(today, weekStartsOn as Weekday)
  const end = addDays(from, 6)
  const working = await ctx.db
    .selectDistinct({ id: people.id, capacity: people.weeklyCapacityMinutes, startedOn: people.startedOn })
    .from(people)
    .innerJoin(projectMembers, and(eq(projectMembers.personId, people.id), isCurrentMembership()))
    .where(eq(people.status, 'active'))
  const handed = await ctx.db.select({ personId: submissions.personId }).from(submissions).where(and(eq(submissions.periodStart, from), inArray(submissions.status, ['submitted', 'approved'])))
  const missing = working.filter(({ id, capacity, startedOn }) => capacity > 0 && (startedOn === null || startedOn <= end) && !handed.some(({ personId }) => personId === id))
  await notify(ctx, missing.map(({ id }) => id), {
    kind: 'timesheet_reminder', title: 'Please submit your week', body: `Your time for the week from ${formatDate(from)} has not been submitted yet.`, path: '/time',
  })
  return missing.length
}

const everyMs = 60_000

/** Looks every minute for what is due. The result stops it, waiting only briefly. */
export function startJobs(ctx: AppContext, email?: SmtpSender): () => Promise<void> {
  let running = Promise.resolve()
  let stopped = false
  let round = 0
  const run = async () => {
    if (stopped) return
    await runDueJobs(ctx)
    if (email && round++ % 10 === 0) await email.retry()
  }
  const timer = setInterval(() => {
    running = running.then(run).catch((error: unknown) => console.error(`Looking for due jobs failed.\n${describeError(error)}`))
  }, everyMs)
  timer.unref()
  return async () => {
    stopped = true
    clearInterval(timer)
    await withTimeout(running, 1000, 'still running a job').catch(() => undefined)
  }
}
