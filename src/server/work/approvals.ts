/** Approving weeks that were handed in. */
import { and, asc, between, desc, eq, gte, inArray } from 'drizzle-orm'
import { addDays, type IsoDate, startOfWeek, type Weekday } from '../../shared/dates'
import type { Approvals, ApprovalWeek } from '../../shared/work'
import { type Actor, loadActor } from '../access/actor'
import { can, forbidden, holds, ownId, requirePermission } from '../access/decisions'
import { filterFor } from '../access/filters'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx } from '../db'
import { approvalEvents, expenseCategories, expenses, invoiceExpenses, invoiceTimeEntries, people, periodUnlocks, projects, submissions, timeEntries } from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { getSettings, lockPerson } from '../people/lookup'
import { logChange } from './common'
import { byCurrency, selectTime, sumBy } from './figures'
import { notify } from './notify'
import { todayOf } from './time'

const missingWeeks = 4
const shownApproved = 30

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

export async function listApprovals(ctx: AppContext, actor: Actor): Promise<Approvals> {
  requirePermission(actor, 'time.approve')
  const { db } = ctx
  const waiting = await db
    .select({ submission: submissions, person: people })
    .from(submissions)
    .innerJoin(people, eq(people.id, submissions.personId))
    .where(eq(submissions.status, 'submitted'))
    .orderBy(asc(submissions.periodStart), asc(people.name))
  const pending: ApprovalWeek[] = []
  for (const { submission, person } of waiting) {
    const week = await readSubmitted(db, actor, submission, person)
    if (week) pending.push(week)
  }

  const today = await todayOf(db, ownId(actor), ctx.now())
  const { weekStartsOn } = await getSettings(db)
  const thisWeek = startOfWeek(today, weekStartsOn as Weekday)
  const oldest = addDays(thisWeek, -7 * missingWeeks)
  const team = await db.select().from(people).where(and(eq(people.status, 'active'), filterFor(db, actor, 'people.view', 'person'))).orderBy(asc(people.name))
  const ids = team.map(({ id }) => id)
  const handed = ids.length === 0 ? [] : await db.select().from(submissions).where(and(inArray(submissions.personId, ids), gte(submissions.periodStart, oldest), inArray(submissions.status, ['submitted', 'approved'])))
  const worked = ids.length === 0 ? [] : await db.select({ personId: timeEntries.personId, spentOn: timeEntries.spentOn, minutes: timeEntries.minutes }).from(timeEntries).where(and(inArray(timeEntries.personId, ids), gte(timeEntries.spentOn, oldest)))
  const missing: Approvals['missing'] = []
  for (let week = 1; week <= missingWeeks; week++) {
    const from = addDays(thisWeek, -7 * week)
    const to = addDays(from, 6)
    for (const person of team) {
      if (person.weeklyCapacityMinutes === 0 || (person.startedOn !== null && person.startedOn > to)) continue
      if (handed.some((row) => row.personId === person.id && row.periodStart <= to && row.periodEnd >= from)) continue
      missing.push({
        person: { id: person.id, name: person.name, photoId: person.photoFileId }, from, to, capacityMinutes: person.weeklyCapacityMinutes,
        minutes: sumBy(worked.filter((row) => row.personId === person.id && row.spentOn >= from && row.spentOn <= to), ({ minutes }) => minutes),
      })
    }
  }

  const done = ids.length === 0 ? [] : await db
    .select({ submission: submissions, person: people.name })
    .from(submissions)
    .innerJoin(people, eq(people.id, submissions.personId))
    .where(and(eq(submissions.status, 'approved'), inArray(submissions.personId, ids)))
    .orderBy(desc(submissions.decidedAt))
    .limit(shownApproved)
  const deciders = new Map((await db.select({ id: people.id, name: people.name }).from(people)).map(({ id, name }) => [id, name]))
  const approved: Approvals['approved'] = []
  for (const { submission, person } of done) {
    const rows = await db
      .select({ minutes: timeEntries.minutes })
      .from(timeEntries)
      .where(and(eq(timeEntries.personId, submission.personId), between(timeEntries.spentOn, submission.periodStart, submission.periodEnd), filterFor(db, actor, 'time.view', 'timeEntry')))
    approved.push({
      submissionId: submission.id, person: { id: submission.personId, name: person }, from: submission.periodStart, to: submission.periodEnd, minutes: sumBy(rows, ({ minutes }) => minutes),
      decidedBy: submission.decidedBy === null ? null : (deciders.get(submission.decidedBy) ?? null),
    })
  }
  return { pending, missing, approved, canUnlock: holds(actor, 'time.unlock', 'all') }
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
