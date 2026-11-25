/** One's own time: entries and the timer. */
import { and, asc, between, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, type SQL } from 'drizzle-orm'
import { addDays, addMonths, type IsoDate, startOfWeek, type Weekday } from '../../shared/dates'
import type { TimeEntry, TimeInput, TimeOptions, TimeProject, TimeWeek } from '../../shared/work'
import { type Actor, loadActor } from '../access/actor'
import { can, forbidden, holds, ownId, requirePermission, requireRecord } from '../access/decisions'
import { filterFor } from '../access/filters'
import { invalidInput } from '../api/input'
import { lockTimeEntryForEdit } from '../billing'
import { todayIn } from '../clock'
import type { AppContext } from '../context'
import { type Db, runTransaction, sumExact, type Tx } from '../db'
import {
  approvalEvents, clients, expenses, people, periodUnlocks, projectMembers, projects, projectTasks, submissions, tasks, timeEntries, timeFavorites,
} from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { getSettings, lockPerson } from '../people/lookup'
import { currentMembership, isCurrentMembership } from '../people/membership'
import { holdPerson, holdProject, logChange } from './common'
import { selectTime, type TimeRow } from './figures'

/** Today, where the person is. */
export async function todayOf(db: Db | Tx, personId: number, now: Date): Promise<IsoDate> {
  const [person] = await db.select({ timeZone: people.timeZone }).from(people).where(eq(people.id, personId))
  return todayIn(person?.timeZone ?? (await getSettings(db)).timeZone, now)
}

/** Whether a date can no longer be changed, because its period is closed or its week was handed in. */
export async function closedOn(db: Db | Tx, personId: number, from: IsoDate, to: IsoDate, today: IsoDate): Promise<(date: IsoDate) => boolean> {
  const { lockedThrough, lockAfterDays, weekStartsOn } = await getSettings(db)
  const unlocked = await db
    .select({ start: periodUnlocks.periodStart, end: periodUnlocks.periodEnd })
    .from(periodUnlocks)
    .where(and(eq(periodUnlocks.personId, personId), or(isNull(periodUnlocks.expiresAt), gt(periodUnlocks.expiresAt, new Date(`${today}T00:00:00Z`)))))
  const handedIn = await db
    .select({ start: submissions.periodStart, end: submissions.periodEnd })
    .from(submissions)
    .where(
      and(
        eq(submissions.personId, personId), inArray(submissions.status, ['submitted', 'approved']),
        lte(submissions.periodStart, to), gte(submissions.periodEnd, from),
      ),
    )
  return (date) => {
    const opened = unlocked.some(({ start, end }) => date >= start && date <= end)
    if (!opened && lockedThrough !== null && date <= lockedThrough) return true
    const weekEnd = addDays(startOfWeek(date, weekStartsOn as Weekday), 6)
    if (!opened && lockAfterDays !== null && addDays(weekEnd, lockAfterDays) < today) return true
    return handedIn.some(({ start, end }) => date >= start && date <= end)
  }
}

export const toEntry =
  (isClosed: (date: IsoDate) => boolean) =>
  (row: TimeRow): TimeEntry => ({
    id: row.id, version: row.version, projectId: row.projectId, project: row.project, projectCode: row.projectCode, client: row.client, taskId: row.taskId, task: row.task,
    spentOn: row.spentOn, minutes: row.minutes, timerStartedAt: row.timerStartedAt?.toISOString() ?? null,
    startMinute: row.startMinute, endMinute: row.endMinute, notes: row.notes,
    billable: row.billable, status: row.status,
    locked: row.invoiceLineId !== null ? 'invoiced' : row.status === 'approved' ? 'approved' : isClosed(row.spentOn) ? 'period' : null,
  })

export async function readRunning(db: Db, personId: number): Promise<TimeEntry | null> {
  const [row] = await selectTime(db).where(and(eq(timeEntries.personId, personId), isNotNull(timeEntries.timerStartedAt)))
  return row ? toEntry(() => false)(row) : null
}

async function readSubmission(db: Db, personId: number, from: IsoDate): Promise<TimeWeek['submission']> {
  const [row] = await db
    .select({ status: submissions.status, comment: submissions.comment })
    .from(submissions)
    .where(and(eq(submissions.personId, personId), eq(submissions.periodStart, from)))
  return row && row.status !== 'withdrawn' ? { status: row.status, comment: row.comment } : null
}

/** Whose time is meant: one's own, or that of someone whose time one may see. */
async function wholeTime(db: Db, actor: Actor, personId: number | null): Promise<{ id: number; own: boolean; seen: SQL | undefined }> {
  const own = ownId(actor)
  if (personId === null || personId === own) return { id: own, own: true, seen: undefined }
  requirePermission(actor, 'time.view')
  const [person] = await db.select({ id: people.id }).from(people).where(eq(people.id, personId))
  if (!person) throw new NotFoundError(personId)
  return { id: personId, own: false, seen: filterFor(db, actor, 'time.view', 'timeEntry') }
}

/** A week of time; one's own without a person, the current one without a date. */
export async function readWeek(ctx: AppContext, actor: Actor, date: IsoDate | null, personId: number | null = null): Promise<TimeWeek> {
  const { db } = ctx
  const who = await wholeTime(db, actor, personId)
  const now = ctx.now()
  const today = await todayOf(db, who.id, now)
  const { weekStartsOn } = await getSettings(db)
  const from = startOfWeek(date ?? today, weekStartsOn as Weekday)
  const to = addDays(from, 6)
  const rows = await selectTime(db)
    .where(and(eq(timeEntries.personId, who.id), between(timeEntries.spentOn, from, to), who.seen))
    .orderBy(asc(timeEntries.spentOn), asc(timeEntries.startMinute), asc(timeEntries.id))
  const others = holds(actor, 'time.view')
    ? await db.select({ id: people.id, name: people.name }).from(people).where(and(eq(people.status, 'active'), filterFor(db, actor, 'people.view', 'person'))).orderBy(asc(people.name))
    : []
  const [person] = await db.select({ name: people.name, capacity: people.weeklyCapacityMinutes }).from(people).where(eq(people.id, who.id))
  return {
    person: { id: who.id, name: person?.name ?? '' }, own: who.own, people: others,
    from, to, today, capacityMinutes: person?.capacity ?? 0,
    entries: rows.map(toEntry(await closedOn(db, who.id, from, to, today))),
    submission: await readSubmission(db, who.id, from),
    running: who.own ? await readRunning(db, who.id) : null,
    now: now.toISOString(),
  }
}

/** Minutes of each day of a month. */
export async function readMonth(db: Db, actor: Actor, month: string, personId: number | null): Promise<{ days: { day: IsoDate; minutes: number }[] }> {
  const who = await wholeTime(db, actor, personId)
  const days = await db
    .select({ day: timeEntries.spentOn, minutes: sumExact(timeEntries.minutes) })
    .from(timeEntries)
    .where(and(eq(timeEntries.personId, who.id), between(timeEntries.spentOn, `${month}-01`, addDays(addMonths(`${month}-01`, 1), -1)), who.seen))
    .groupBy(timeEntries.spentOn)
  return { days }
}

/** The projects and tasks that time can be entered on. */
export async function readTimeOptions(db: Db, actor: Actor, personId: number | null = null): Promise<TimeOptions> {
  const who = await wholeTime(db, actor, personId)
  const rows = await db
    .select({
      id: projects.id, name: projects.name, code: projects.code, client: clients.name, taskId: tasks.id, task: tasks.name,
      billable: projectTasks.billable, type: projects.type,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(projectTasks, and(eq(projectTasks.projectId, projects.id), isNull(projectTasks.removedAt)))
    .innerJoin(tasks, eq(tasks.id, projectTasks.taskId))
    .where(and(eq(projectMembers.personId, who.id), isCurrentMembership(), isNull(projects.archivedAt), isNull(clients.archivedAt)))
    .orderBy(asc(clients.name), asc(projects.name), desc(projectTasks.billable), asc(tasks.name))
  const found = new Map<number, TimeProject>()
  for (const { id, name, code, client, taskId, task, billable, type } of rows) {
    if (!who.own && !can(actor, 'time.edit', { type: 'timeEntry', personId: who.id, projectId: id })) continue
    const project = found.get(id) ?? { id, name, code, client, tasks: [] }
    project.tasks.push({ id: taskId, name: task, billable: billable && type !== 'non_billable' })
    found.set(id, project)
  }
  const favorites = await db.select().from(timeFavorites).where(eq(timeFavorites.personId, ownId(actor))).orderBy(asc(timeFavorites.position), asc(timeFavorites.id))
  return {
    projects: [...found.values()],
    favorites: favorites.map(({ id, projectId, taskId, notes }) => ({ id, projectId, taskId, notes })),
    notesRequired: (await getSettings(db)).timeNotesRequired,
  }
}

export async function saveFavorite(db: Db, actor: Actor, input: { projectId: number; taskId: number; notes: string }): Promise<void> {
  const personId = ownId(actor)
  await runTransaction(db, async (tx) => {
    await checkTask(tx, personId, input.projectId, input.taskId)
    await tx.insert(timeFavorites).values({ personId, ...input }).onConflictDoNothing()
  })
}

export async function removeFavorite(db: Db, actor: Actor, id: number): Promise<void> {
  await db.delete(timeFavorites).where(and(eq(timeFavorites.id, id), eq(timeFavorites.personId, ownId(actor))))
}

const periodClosed = () => new ApiError(409, 'period_closed', 'This week was submitted or is locked. It cannot be changed.')

async function checkOpen(tx: Tx, personId: number, date: IsoDate, now: Date): Promise<void> {
  const isClosed = await closedOn(tx, personId, date, date, await todayOf(tx, personId, now))
  if (isClosed(date)) throw periodClosed()
}

/** Whether time on the task is billable, for someone who may enter it. */
async function checkTask(tx: Tx, personId: number, projectId: number, taskId: number): Promise<boolean> {
  const [found] = await tx
    .select({ project: projects, client: clients, task: projectTasks })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(projectTasks, and(eq(projectTasks.projectId, projects.id), eq(projectTasks.taskId, taskId), isNull(projectTasks.removedAt)))
    .where(eq(projects.id, projectId))
  const member = await currentMembership(tx, personId, projectId)
  if (!found || !member || found.project.archivedAt || found.client.archivedAt) {
    throw invalidInput({ projectId: 'Choose a project and task that you are on.' })
  }
  return found.task.billable && found.project.type !== 'non_billable'
}

/** Start and end give the minutes; notes are there where the company wants them. */
async function checkEntry<T extends Pick<TimeInput, 'minutes' | 'startMinute' | 'endMinute' | 'notes'>>(tx: Tx, input: T, running: boolean): Promise<T> {
  const { timeNotesRequired } = await getSettings(tx)
  if (timeNotesRequired && !running && input.notes === '') throw invalidInput({ notes: 'Enter notes.' })
  if ((input.startMinute === null) !== (input.endMinute === null)) throw invalidInput({ endMinute: 'Enter both start and end.' })
  if (input.startMinute === null || input.endMinute === null) return input
  if (input.endMinute < input.startMinute) throw invalidInput({ endMinute: 'The end is before the start.' })
  return { ...input, minutes: input.endMinute - input.startMinute }
}

/** For oneself, or for someone whose time one may enter. */
export async function createEntry(ctx: AppContext, actor: Actor, input: TimeInput, start: boolean, forPerson: number | null = null): Promise<void> {
  const own = ownId(actor)
  const personId = forPerson ?? own
  if (personId !== own) {
    requireRecord(actor, { view: 'time.view', action: 'time.edit' }, { type: 'timeEntry', personId, projectId: input.projectId })
    if (start) throw invalidInput({ minutes: 'A timer can only be started for yourself.' })
  }
  await runTransaction(ctx.db, async (tx) => {
    await holdProject(tx, input.projectId, 'use')
    await holdPerson(tx, personId, 'use')
    await checkOpen(tx, personId, input.spentOn, ctx.now())
    const billable = await checkTask(tx, personId, input.projectId, input.taskId)
    const values = await checkEntry(tx, input, start)
    if (start) await stopRunning(tx, personId, ctx.now())
    const [entry] = await tx
      .insert(timeEntries)
      .values({ ...values, personId, billable, createdBy: own, timerStartedAt: start ? ctx.now() : null })
      .returning({ id: timeEntries.id })
    if (personId !== own) await logChange(tx, actor, { action: 'created', type: 'time', id: entry?.id ?? null, summary: `Entered time for someone else on ${input.spentOn}` })
  })
}

export async function updateEntry(ctx: AppContext, actor: Actor, id: number, { version, ...input }: TimeInput & { version: number }): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const entry = await lockTimeEntryForEdit(tx, actor, id, version, { projectId: input.projectId })
    await checkOpen(tx, entry.personId, entry.spentOn, ctx.now())
    await checkOpen(tx, entry.personId, input.spentOn, ctx.now())
    const moved = entry.projectId !== input.projectId || entry.taskId !== input.taskId
    const billable = moved ? await checkTask(tx, entry.personId, input.projectId, input.taskId) : entry.billable
    const values = await checkEntry(tx, input, entry.timerStartedAt !== null)
    await tx.update(timeEntries).set({ ...values, billable }).where(eq(timeEntries.id, id))
    if (entry.personId !== ownId(actor)) {
      await logChange(tx, actor, { action: 'updated', type: 'time', id, summary: `Changed someone else's time on ${input.spentOn}`, changes: { minutes: [entry.minutes, values.minutes] } })
    }
  })
}

export async function deleteEntry(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const entry = await lockTimeEntryForEdit(tx, actor, id, version)
    await checkOpen(tx, entry.personId, entry.spentOn, ctx.now())
    await tx.delete(timeEntries).where(eq(timeEntries.id, id))
    if (entry.personId !== ownId(actor)) await logChange(tx, actor, { action: 'deleted', type: 'time', id, summary: `Deleted someone else's time on ${entry.spentOn}` })
  })
}

const dayMinutes = 1440

/** The entry's minutes with those of its timer, never more than a day. */
export const stoppedMinutes = (minutes: number, startedAt: Date, now: Date): number =>
  Math.min(dayMinutes, minutes + Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 60_000)))

async function stopRunning(tx: Tx, personId: number, now: Date): Promise<void> {
  const [running] = await tx
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.personId, personId), isNotNull(timeEntries.timerStartedAt)))
    .for('update')
  if (!running?.timerStartedAt) return
  await tx
    .update(timeEntries)
    .set({ minutes: stoppedMinutes(running.minutes, running.timerStartedAt, now), timerStartedAt: null })
    .where(eq(timeEntries.id, running.id))
}

export async function stopTimer(ctx: AppContext, actor: Actor): Promise<void> {
  const personId = ownId(actor)
  await runTransaction(ctx.db, (tx) => stopRunning(tx, personId, ctx.now()))
}

export async function startTimer(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  const personId = ownId(actor)
  await runTransaction(ctx.db, async (tx) => {
    const entry = await lockTimeEntryForEdit(tx, actor, id, version)
    if (entry.personId !== personId) throw invalidInput({ id: 'Only your own timer can be started.' })
    await checkOpen(tx, personId, entry.spentOn, ctx.now())
    await checkTask(tx, personId, entry.projectId, entry.taskId)
    if (entry.timerStartedAt) return
    await stopRunning(tx, personId, ctx.now())
    await tx.update(timeEntries).set({ timerStartedAt: ctx.now() }).where(eq(timeEntries.id, id))
  })
}

// Handing in a week ----------------------------------------------------------------------------------

/** The week of a date, locked against a second hand-in at the same time. */
async function lockWeek(tx: Tx, personId: number, date: IsoDate) {
  await lockPerson(tx, personId)
  const { weekStartsOn, approvalEnabled } = await getSettings(tx)
  const start = startOfWeek(date, weekStartsOn as Weekday)
  const [submission] = await tx
    .select()
    .from(submissions)
    .where(and(eq(submissions.personId, personId), eq(submissions.periodStart, start)))
    .for('update')
  const inWeek = (table: typeof timeEntries | typeof expenses): SQL | undefined =>
    and(eq(table.personId, personId), between(table.spentOn, start, addDays(start, 6)))
  return { start, end: addDays(start, 6), submission, inWeek, approvalEnabled }
}

/** Hands in the week for approval, with its expenses. */
export async function submitWeek(ctx: AppContext, actor: Actor, date: IsoDate, personId = ownId(actor)): Promise<{ from: IsoDate; projectIds: number[] }> {
  const by = ownId(actor)
  return runTransaction(ctx.db, async (tx) => {
    // Whoever decides about someone's time may hand it in for them.
    if (personId !== by && !can(await loadActor(tx, by), 'time.approve', { type: 'person', personId })) throw forbidden()
    const { start, end, submission, inWeek, approvalEnabled } = await lockWeek(tx, personId, date)
    if (!approvalEnabled) throw new ApiError(409, 'approval_off', 'Weeks are not submitted here.')
    if (submission?.status === 'submitted' || submission?.status === 'approved') {
      throw new ApiError(409, 'already_handled', 'This week was already submitted.')
    }
    const entries = await tx.select().from(timeEntries).where(inWeek(timeEntries)).for('update')
    if (entries.some(({ timerStartedAt }) => timerStartedAt !== null)) throw new ApiError(409, 'running', 'Stop the timer first.')
    const spent = await tx.select({ id: expenses.id, projectId: expenses.projectId }).from(expenses).where(inWeek(expenses))
    if (entries.length + spent.length === 0) throw new ApiError(409, 'nothing_to_submit', 'There is nothing in this week to submit.')
    const open = ['unsubmitted', 'rejected'] as const
    await tx.update(timeEntries).set({ status: 'submitted' }).where(and(inWeek(timeEntries), inArray(timeEntries.status, open)))
    await tx.update(expenses).set({ status: 'submitted' }).where(and(inWeek(expenses), inArray(expenses.status, open)))
    const values = { status: 'submitted' as const, submittedAt: ctx.now(), comment: '', decidedBy: null, decidedAt: null }
    const [row] = submission
      ? await tx.update(submissions).set(values).where(eq(submissions.id, submission.id)).returning()
      : await tx.insert(submissions).values({ personId, periodStart: start, periodEnd: end, ...values }).returning()
    if (!row) throw new Error('The week was not stored.')
    await tx.insert(approvalEvents).values({ submissionId: row.id, actorId: by, action: 'submitted' })
    const [person] = personId === by ? [] : await tx.select({ name: people.name }).from(people).where(eq(people.id, personId))
    await logChange(tx, actor, { action: 'submitted', type: 'submission', id: row.id, summary: `Submitted the week from ${start}${person ? ` for ${person.name}` : ''}` })
    return { from: start, projectIds: [...new Set([...entries.map(({ projectId }) => projectId), ...spent.map(({ projectId }) => projectId)])] }
  })
}

/** Takes the week back, as long as nobody decided. */
export async function withdrawWeek(ctx: AppContext, actor: Actor, date: IsoDate): Promise<void> {
  const personId = ownId(actor)
  await runTransaction(ctx.db, async (tx) => {
    const { submission, inWeek } = await lockWeek(tx, personId, date)
    if (submission?.status !== 'submitted') throw new ApiError(409, 'already_handled', 'This week is not waiting for approval.')
    await tx.update(timeEntries).set({ status: 'unsubmitted' }).where(and(inWeek(timeEntries), eq(timeEntries.status, 'submitted')))
    await tx.update(expenses).set({ status: 'unsubmitted' }).where(and(inWeek(expenses), eq(expenses.status, 'submitted')))
    await tx.update(submissions).set({ status: 'withdrawn' }).where(eq(submissions.id, submission.id))
    await tx.insert(approvalEvents).values({ submissionId: submission.id, actorId: personId, action: 'withdrawn' })
  })
}

/** Adds what was worked on the last day before that has time: the rows only, or with hours and notes. */
export async function copyPreviousDay(ctx: AppContext, actor: Actor, date: IsoDate, withHours: boolean): Promise<void> {
  const personId = ownId(actor)
  await runTransaction(ctx.db, async (tx) => {
    await lockPerson(tx, personId)
    await checkOpen(tx, personId, date, ctx.now())
    const own = eq(timeEntries.personId, personId)
    const [last] = await tx.select({ day: timeEntries.spentOn }).from(timeEntries).where(and(own, lt(timeEntries.spentOn, date))).orderBy(desc(timeEntries.spentOn)).limit(1)
    if (!last) throw new ApiError(409, 'nothing_to_copy', 'There is no earlier day to copy from.')
    const before = await tx.select().from(timeEntries).where(and(own, eq(timeEntries.spentOn, last.day))).orderBy(asc(timeEntries.id))
    const there = await tx.select().from(timeEntries).where(and(own, eq(timeEntries.spentOn, date)))
    const known = new Set(there.map(({ projectId, taskId }) => `${projectId}/${taskId}`))
    let added = 0
    for (const { projectId, taskId, minutes, notes } of before) {
      const key = `${projectId}/${taskId}`
      if (known.has(key)) continue
      const billable = await checkTask(tx, personId, projectId, taskId).catch((error: unknown) => {
        // No longer on it, or it is archived.
        if (error instanceof ApiError) return null
        throw error
      })
      if (billable === null) continue
      if (!withHours) known.add(key)
      await tx.insert(timeEntries).values({
        personId, projectId, taskId, spentOn: date, billable, createdBy: personId, minutes: withHours ? minutes : 0, notes: withHours ? notes : '',
      })
      added++
    }
    if (added === 0) throw new ApiError(409, 'nothing_to_copy', 'There is nothing to add from the day before.')
  })
}
