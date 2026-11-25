/** Approving weeks that were handed in. */
import { and, asc, between, eq, gte, inArray, lte, or } from 'drizzle-orm'
import { addDays, type IsoDate, startOfWeek, type Weekday } from '../../shared/dates'
import type { EntryStatus } from '../../shared/domain'
import type { ApprovalLine, ApprovalPerson, Approvals, ApprovalStatus, ApprovalWeek } from '../../shared/work'
import { type Actor, isSystem, loadActor } from '../access/actor'
import { can, forbidden, holds, ownId, requirePermission, requireRecord } from '../access/decisions'
import { filterFor } from '../access/filters'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx } from '../db'
import {
  approvalEvents, clients, companySettings, expenseCategories, expenses, invoiceExpenses, invoiceTimeEntries, labels, people, periodUnlocks, personLabels, projects, projectTags, submissions, tags,
  timeEntries,
} from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { getSettings, lockPerson } from '../people/lookup'
import { logChange } from './common'
import { byCurrency, selectTime, sumBy } from './figures'
import { notify } from './notify'
import { submitWeek, todayOf } from './time'

async function readSubmitted(db: Db, actor: Actor, submission: typeof submissions.$inferSelect, person: typeof people.$inferSelect): Promise<ApprovalWeek | null> {
  const inWeek = [submission.periodStart, submission.periodEnd] as const
  const rows = await selectTime(db)
    .where(and(eq(timeEntries.personId, person.id), between(timeEntries.spentOn, ...inWeek), eq(timeEntries.status, 'submitted')))
    .orderBy(asc(timeEntries.spentOn), asc(timeEntries.id))
  const spent = await db
    .select({ expense: expenses, project: projects.name, category: expenseCategories.name })
    .from(expenses)
    .innerJoin(projects, eq(projects.id, expenses.projectId))
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(and(eq(expenses.personId, person.id), between(expenses.spentOn, ...inWeek), eq(expenses.status, 'submitted')))
    .orderBy(asc(expenses.spentOn))
  const entries = rows.filter((row) => can(actor, 'time.view', { type: 'timeEntry', personId: person.id, projectId: row.projectId }))
  const mine = (projectId: number, type: 'timeEntry' | 'expense') => can(actor, 'time.approve', { type, personId: person.id, projectId })
  const seenSpent = spent.filter(({ expense }) => can(actor, 'time.view', { type: 'expense', personId: person.id, projectId: expense.projectId }))
  if (![...entries.map(({ projectId }) => mine(projectId, 'timeEntry')), ...seenSpent.map(({ expense }) => mine(expense.projectId, 'expense'))].includes(true)) return null
  return {
    submissionId: submission.id, person: { id: person.id, name: person.name, photoId: person.photoFileId }, from: submission.periodStart, to: submission.periodEnd,
    submittedAt: submission.submittedAt.toISOString(),
    minutes: sumBy(entries, ({ minutes }) => minutes), billableMinutes: sumBy(entries.filter(({ billable }) => billable), ({ minutes }) => minutes),
    capacityMinutes: person.weeklyCapacityMinutes,
    expenses: byCurrency(seenSpent.map(({ expense }) => expense), ({ amount }) => amount),
    entries: entries.map((row) => ({
      id: row.id, spentOn: row.spentOn, client: row.client, project: row.project, task: row.task, minutes: row.minutes, billable: row.billable, notes: row.notes,
      mine: mine(row.projectId, 'timeEntry'),
    })),
    expenseRows: seenSpent.map(({ expense, project, category }) => ({
      id: expense.id, spentOn: expense.spentOn, project, category, amount: expense.amount, currency: expense.currency, notes: expense.notes, mine: mine(expense.projectId, 'expense'),
    })),
  }
}

const statusOf = (status: EntryStatus): ApprovalStatus => (status === 'submitted' || status === 'approved' ? status : 'open')

/** The weeks that a period touches. */
export function weeksOf(from: IsoDate, to: IsoDate, weekStart: Weekday): IsoDate[] {
  const weeks: IsoDate[] = []
  for (let start = startOfWeek(from, weekStart); start <= to; start = addDays(start, 7)) weeks.push(start)
  return weeks
}

const mostDays = 366

function checkRange(from: IsoDate, to: IsoDate) {
  if (from > to) throw invalidInput({ to: 'The end is before the start.' })
  if (addDays(from, mostDays) < to) throw invalidInput({ to: 'Choose at most a year.' })
}

/** Everything of a period that the actor decides about. */
export async function listApprovals(ctx: AppContext, actor: Actor, from: IsoDate, to: IsoDate): Promise<Approvals> {
  requirePermission(actor, 'time.approve')
  checkRange(from, to)
  const { db } = ctx
  const settings = await getSettings(db)
  const today = await todayOf(db, ownId(actor), ctx.now())

  const time = await db
    .select({ personId: timeEntries.personId, projectId: timeEntries.projectId, spentOn: timeEntries.spentOn, minutes: timeEntries.minutes, billable: timeEntries.billable, status: timeEntries.status })
    .from(timeEntries)
    .where(and(between(timeEntries.spentOn, from, to), filterFor(db, actor, 'time.approve', 'timeEntry')))
  const spent = await db
    .select({ personId: expenses.personId, projectId: expenses.projectId, spentOn: expenses.spentOn, amount: expenses.amount, currency: expenses.currency, billable: expenses.billable, status: expenses.status })
    .from(expenses)
    .where(and(between(expenses.spentOn, from, to), filterFor(db, actor, 'time.approve', 'expense')))

  const lines = new Map<string, ApprovalLine>()
  const lineOf = ({ personId, projectId, status }: { personId: number; projectId: number; status: EntryStatus }): ApprovalLine => {
    const key = `${personId}/${projectId}/${statusOf(status)}`
    const line = lines.get(key) ?? { personId, projectId, status: statusOf(status), minutes: 0, billableMinutes: 0, expenses: [] }
    lines.set(key, line)
    return line
  }
  for (const entry of time) {
    const line = lineOf(entry)
    line.minutes += entry.minutes
    if (entry.billable) line.billableMinutes += entry.minutes
  }
  for (const expense of spent) {
    const line = lineOf(expense)
    let sum = line.expenses.find(({ currency }) => currency === expense.currency)
    if (!sum) line.expenses.push((sum = { currency: expense.currency, billable: 0, other: 0 }))
    sum[expense.billable ? 'billable' : 'other'] += expense.amount
  }

  const seen = new Set([...time, ...spent].map(({ personId }) => personId))
  const team = await db
    .select()
    .from(people)
    .where(or(and(eq(people.status, 'active'), filterFor(db, actor, 'time.approve', 'person')), inArray(people.id, seen.size > 0 ? [...seen] : [0])))
    .orderBy(asc(people.name))
  const ids = team.map(({ id }) => id)
  const named = ids.length === 0 ? [] : await db.select({ personId: personLabels.personId, name: labels.name }).from(personLabels).innerJoin(labels, eq(labels.id, personLabels.labelId)).where(inArray(personLabels.personId, ids))
  const handed = ids.length === 0 ? [] : await db
    .select()
    .from(submissions)
    .where(and(inArray(submissions.personId, ids), lte(submissions.periodStart, to), gte(submissions.periodEnd, from), inArray(submissions.status, ['submitted', 'approved'])))
    .orderBy(asc(submissions.periodStart))
  const deciders = new Map((await db.select({ id: people.id, name: people.name }).from(people)).map(({ id, name }) => [id, name]))
  const weeks = weeksOf(from, to, settings.weekStartsOn as Weekday).filter((start) => start <= today)

  const found = team.map((person): ApprovalPerson => {
    const own = handed.filter(({ personId }) => personId === person.id)
    const open = weeks.filter((start) => !own.some(({ periodStart, periodEnd }) => periodStart <= addDays(start, 6) && periodEnd >= start))
    const decides = can(actor, 'time.approve', { type: 'person', personId: person.id })
    const something = [...time, ...spent].some(({ personId, spentOn }) => personId === person.id && open.some((start) => spentOn >= start && spentOn <= addDays(start, 6)))
    return {
      id: person.id, name: person.name, photoId: person.photoFileId, department: person.department,
      labels: named.filter(({ personId }) => personId === person.id).map(({ name }) => name),
      missing: person.status === 'active' && person.weeklyCapacityMinutes > 0 && open.some((start) => person.startedOn === null || person.startedOn <= addDays(start, 6)),
      canSubmit: decides && something,
      canRemind: person.status === 'active' && can(actor, 'people.view', { type: 'person', personId: person.id }),
      approved: own
        .filter(({ status }) => status === 'approved')
        .map(({ id, periodStart, periodEnd, decidedBy }) => ({ submissionId: id, from: periodStart, to: periodEnd, decidedBy: decidedBy === null ? null : (deciders.get(decidedBy) ?? null) })),
    }
  })

  const projectIds = [...new Set([...time, ...spent].map(({ projectId }) => projectId))]
  const used = projectIds.length === 0 ? [] : await db
    .select({ id: projects.id, name: projects.name, clientId: clients.id, client: clients.name })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(inArray(projects.id, projectIds))
    .orderBy(asc(projects.name))
  const tagged = projectIds.length === 0 ? [] : await db.select({ projectId: projectTags.projectId, name: tags.name }).from(projectTags).innerJoin(tags, eq(tags.id, projectTags.tagId)).where(inArray(projectTags.projectId, projectIds))

  const waiting = await db
    .select({ submission: submissions, person: people })
    .from(submissions)
    .innerJoin(people, eq(people.id, submissions.personId))
    .where(eq(submissions.status, 'submitted'))
    .orderBy(asc(submissions.periodStart), asc(people.name))
  const pending: ApprovalWeek[] = []
  const elsewhere = new Map<string, Approvals['elsewhere'][number]>()
  for (const { submission, person } of waiting) {
    const week = await readSubmitted(db, actor, submission, person)
    if (!week) continue
    if (week.from <= to && week.to >= from) pending.push(week)
    else {
      const known = elsewhere.get(week.from) ?? { from: week.from, to: week.to, count: 0 }
      known.count++
      elsewhere.set(week.from, known)
    }
  }

  const { lockedThrough, lockAfterDays, reminderWeekday, reminderMinute } = settings
  return {
    from, to, today,
    lock: { through: lockedThrough, afterDays: lockAfterDays },
    canLock: holds(actor, 'settings.manage', 'all'), canUnlock: holds(actor, 'time.unlock', 'all'),
    reminder: reminderWeekday === null ? null : { weekday: reminderWeekday, minute: reminderMinute },
    people: found,
    projects: used.map(({ id, name, clientId, client }) => ({ id, name, client: { id: clientId, name: client }, tags: tagged.filter(({ projectId }) => projectId === id).map((tag) => tag.name) })),
    lines: [...lines.values()], pending, elsewhere: [...elsewhere.values()],
  }
}

export interface ForceSubmitted {
  submitted: number
  /** Whose week could not be submitted, and why. */
  refused: { person: string; message: string }[]
}

/** Hands in the weeks of a period for people who did not, as far as there is something in them. */
export async function forceSubmit(ctx: AppContext, actor: Actor, personIds: readonly number[], from: IsoDate, to: IsoDate): Promise<ForceSubmitted> {
  requirePermission(actor, 'time.approve')
  checkRange(from, to)
  const { weekStartsOn } = await getSettings(ctx.db)
  const today = await todayOf(ctx.db, ownId(actor), ctx.now())
  const result: ForceSubmitted = { submitted: 0, refused: [] }
  for (const personId of personIds) {
    requireRecord(actor, { view: 'time.approve' }, { type: 'person', personId }, personId)
    const [person] = await ctx.db.select({ name: people.name }).from(people).where(eq(people.id, personId))
    if (!person) throw new NotFoundError(personId)
    for (const start of weeksOf(from, to, weekStartsOn as Weekday)) {
      if (start > today) continue
      try {
        const { from: week, projectIds } = await submitWeek(ctx, actor, start, personId)
        result.submitted++
        if (personId === ownId(actor)) continue
        const by = isSystem(actor) ? '' : actor.name
        await notify(ctx, [personId], { kind: 'submitted_for', title: 'Your week was submitted for you', body: `${by} submitted your week from ${week}.`, path: '/time' })
        await notify(ctx, (await approversOf(ctx.db, personId, projectIds)).filter((id) => id !== ownId(actor)), {
          kind: 'approval', title: `${by} submitted a week of ${person.name}`, body: `The week from ${week} is waiting for approval.`, path: approvalPath(week),
        })
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error
        // Nothing in it, or handed in meanwhile: there is nothing to do.
        if (error.code !== 'nothing_to_submit' && error.code !== 'already_handled') result.refused.push({ person: person.name, message: error.message })
      }
    }
  }
  return result
}

/** The page where a week is decided about. */
export const approvalPath = (week: IsoDate) => `/approvals?status=submitted&period=week&from=${week}`

/** Locks everything up to a date. Never takes a later lock back. */
export async function lockThrough(ctx: AppContext, actor: Actor, date: IsoDate): Promise<void> {
  requirePermission(actor, 'settings.manage', 'all')
  await runTransaction(ctx.db, async (tx) => {
    const [before] = await tx.select().from(companySettings).for('update')
    if (before?.lockedThrough && before.lockedThrough >= date) throw new ApiError(409, 'already_locked', 'This is locked already.')
    await tx.update(companySettings).set({ lockedThrough: date }).where(eq(companySettings.id, 1))
    await logChange(tx, actor, { action: 'updated', type: 'settings', id: 1, summary: `Locked time and expenses up to ${date}`, changes: { lockedThrough: [before?.lockedThrough ?? null, date] } })
  })
}

/** Approves several weeks. Those that someone else decided meanwhile are left out. */
export async function approveWeeks(ctx: AppContext, actor: Actor, ids: readonly number[]): Promise<number> {
  let done = 0
  for (const id of ids) {
    try {
      await approveWeek(ctx, actor, id)
      done++
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'already_handled') throw error
    }
  }
  return done
}

/** The week, locked, with what of it waits. */
async function lockSubmission(tx: Tx, id: number) {
  const [seen] = await tx.select().from(submissions).where(eq(submissions.id, id))
  if (!seen) throw new NotFoundError(id)
  await lockPerson(tx, seen.personId)
  const [submission] = await tx.select().from(submissions).where(eq(submissions.id, id)).for('update')
  if (!submission) throw new NotFoundError(id)
  const inWeek = (table: typeof timeEntries | typeof expenses) => and(eq(table.personId, submission.personId), between(table.spentOn, submission.periodStart, submission.periodEnd))
  const time = await tx.select().from(timeEntries).where(inWeek(timeEntries)).orderBy(asc(timeEntries.id)).for('update')
  const spent = await tx.select().from(expenses).where(inWeek(expenses)).orderBy(asc(expenses.id)).for('update')
  return { submission, time, spent }
}

const handled = () => new ApiError(409, 'already_handled', 'This week is no longer waiting for approval.')

/** Approves what the actor may approve of the week. It is approved as a whole once nothing waits. */
export async function approveWeek(ctx: AppContext, actor: Actor, id: number): Promise<void> {
  requirePermission(actor, 'time.approve')
  const done = await runTransaction(ctx.db, async (tx) => {
    const { submission, time, spent } = await lockSubmission(tx, id)
    const editor = await loadActor(tx, ownId(actor))
    const facts = { personId: submission.personId }
    const myTime = time.filter(({ status, projectId }) => status === 'submitted' && can(editor, 'time.approve', { type: 'timeEntry', ...facts, projectId }))
    const mySpent = spent.filter(({ status, projectId }) => status === 'submitted' && can(editor, 'time.approve', { type: 'expense', ...facts, projectId }))
    const covers = [...time.map(({ projectId }) => projectId), ...spent.map(({ projectId }) => projectId)].some((projectId) => can(editor, 'time.approve', { type: 'timeEntry', ...facts, projectId }))
    if (!covers) throw new NotFoundError(id)
    if (submission.status !== 'submitted' || myTime.length + mySpent.length === 0) throw handled()
    if (myTime.length > 0) await tx.update(timeEntries).set({ status: 'approved' }).where(inArray(timeEntries.id, myTime.map((row) => row.id)))
    for (const row of mySpent) {
      await tx.update(expenses).set({ status: 'approved', ...(row.reimbursementStatus === 'pending' && { reimbursementStatus: 'approved' as const }) }).where(eq(expenses.id, row.id))
    }
    await tx.insert(approvalEvents).values({ submissionId: id, actorId: editor.id, action: 'approved' })
    const left = [...time, ...spent].filter(({ status }) => status === 'submitted').length - myTime.length - mySpent.length
    if (left === 0) await tx.update(submissions).set({ status: 'approved', decidedBy: editor.id, decidedAt: ctx.now() }).where(eq(submissions.id, id))
    await logChange(tx, actor, { action: 'approved', type: 'submission', id, summary: `Approved ${left === 0 ? 'the' : 'a part of the'} week from ${submission.periodStart}` })
    return left === 0 ? submission : null
  })
  if (done) {
    await notify(ctx, [done.personId], { kind: 'approved', title: 'Your week was approved', body: `The week from ${done.periodStart} to ${done.periodEnd} was approved.`, path: '/time' })
  }
}

/** Sends the whole week back. What was invoiced already stays approved. */
export async function rejectWeek(ctx: AppContext, actor: Actor, id: number, comment: string): Promise<void> {
  requirePermission(actor, 'time.approve')
  const week = await runTransaction(ctx.db, async (tx) => {
    const { submission, time, spent } = await lockSubmission(tx, id)
    const editor = await loadActor(tx, ownId(actor))
    const covers = [...time, ...spent].some(({ projectId, status }) => status === 'submitted' && can(editor, 'time.approve', { type: 'timeEntry', personId: submission.personId, projectId }))
    if (!covers) throw submission.status === 'submitted' ? new NotFoundError(id) : handled()
    await openEntries(tx, time, spent, 'rejected')
    await tx.update(submissions).set({ status: 'rejected', comment, decidedBy: editor.id, decidedAt: ctx.now() }).where(eq(submissions.id, id))
    await tx.insert(approvalEvents).values({ submissionId: id, actorId: editor.id, action: 'rejected', comment })
    await logChange(tx, actor, { action: 'rejected', type: 'submission', id, summary: `Sent back the week from ${submission.periodStart}` })
    return submission
  })
  await notify(ctx, [week.personId], {
    kind: 'rejected', title: 'Your week was sent back', body: `The week from ${week.periodStart} to ${week.periodEnd} was sent back.${comment ? `\n\n${comment}` : ''}`, path: '/time',
  })
}

async function openEntries(tx: Tx, time: (typeof timeEntries.$inferSelect)[], spent: (typeof expenses.$inferSelect)[], status: 'rejected' | 'unsubmitted') {
  const timeIds = time.map((row) => row.id)
  const spentIds = spent.map((row) => row.id)
  const billed = new Set(timeIds.length === 0 ? [] : (await tx.select({ id: invoiceTimeEntries.timeEntryId }).from(invoiceTimeEntries).where(inArray(invoiceTimeEntries.timeEntryId, timeIds))).map((row) => row.id))
  const billedSpent = new Set(spentIds.length === 0 ? [] : (await tx.select({ id: invoiceExpenses.expenseId }).from(invoiceExpenses).where(inArray(invoiceExpenses.expenseId, spentIds))).map((row) => row.id))
  const free = timeIds.filter((id) => !billed.has(id))
  const freeSpent = spent.filter((row) => !billedSpent.has(row.id) && row.reimbursementStatus !== 'paid')
  if (free.length > 0) await tx.update(timeEntries).set({ status }).where(inArray(timeEntries.id, free))
  for (const row of freeSpent) {
    await tx.update(expenses).set({ status, ...(row.reimbursementStatus === 'approved' && { reimbursementStatus: 'pending' as const }) }).where(eq(expenses.id, row.id))
  }
}

/** Opens an approved week again, so that its owner can change and submit it. Invoiced entries stay locked. */
export async function reopenWeek(ctx: AppContext, actor: Actor, id: number): Promise<void> {
  if (!holds(actor, 'time.unlock', 'all')) throw forbidden()
  await runTransaction(ctx.db, async (tx) => {
    const { submission, time, spent } = await lockSubmission(tx, id)
    if (submission.status !== 'approved') throw new ApiError(409, 'already_handled', 'This week is not approved.')
    await openEntries(tx, time, spent, 'unsubmitted')
    await tx.update(submissions).set({ status: 'withdrawn' }).where(eq(submissions.id, id))
    await tx.insert(approvalEvents).values({ submissionId: id, actorId: ownId(actor), action: 'unlocked' })
    await logChange(tx, actor, { action: 'unlocked', type: 'submission', id, summary: `Opened the week from ${submission.periodStart} again` })
  })
}

const unlockDays = 7

/** Lets someone change a week that is locked by date, for a while. */
export async function unlockPeriod(ctx: AppContext, actor: Actor, personId: number, date: IsoDate): Promise<void> {
  if (!holds(actor, 'time.unlock', 'all')) throw forbidden()
  await runTransaction(ctx.db, async (tx) => {
    const person = await lockPerson(tx, personId)
    if (!person) throw new NotFoundError(personId)
    const { weekStartsOn } = await getSettings(tx)
    const periodStart = startOfWeek(date, weekStartsOn as Weekday)
    const expiresAt = new Date(ctx.now().getTime() + unlockDays * 86_400_000)
    await tx.insert(periodUnlocks).values({ personId, periodStart, periodEnd: addDays(periodStart, 6), unlockedBy: ownId(actor), expiresAt })
    await logChange(tx, actor, { action: 'unlocked', type: 'submission', id: null, summary: `Unlocked the week from ${periodStart} for ${person.name}` })
  })
}

/** Reminds people to hand in a week. */
export async function remind(ctx: AppContext, actor: Actor, personIds: number[], date: IsoDate): Promise<number> {
  requirePermission(actor, 'time.approve')
  const seen = await ctx.db.select({ id: people.id }).from(people).where(and(inArray(people.id, personIds.length > 0 ? personIds : [0]), filterFor(ctx.db, actor, 'people.view', 'person')))
  await notify(ctx, seen.map(({ id }) => id), {
    kind: 'timesheet_reminder', title: 'Please submit your week', body: `Your time for the week from ${date} has not been submitted yet.`, path: '/time',
  })
  return seen.length
}

/** Who may approve something of the person's week. */
export async function approversOf(db: Db, personId: number, projectIds: readonly number[]): Promise<number[]> {
  const candidates = await db.select({ id: people.id }).from(people).where(eq(people.status, 'active'))
  const found: number[] = []
  for (const { id } of candidates) {
    if (id === personId) continue
    const actor = await loadActor(db, id)
    // Whoever may approve everything is told only if nobody closer is.
    if (actor.grants['time.approve'] === 'managed' && projectIds.some((projectId) => can(actor, 'time.approve', { type: 'timeEntry', personId, projectId }))) found.push(id)
  }
  if (found.length > 0) return found
  for (const { id } of candidates) {
    if (id !== personId && (await loadActor(db, id)).grants['time.approve'] === 'all') found.push(id)
  }
  return found
}
