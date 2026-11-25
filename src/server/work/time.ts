/** One's own time: entries and the timer. */
import { and, asc, between, desc, eq, inArray, isNotNull, isNull, lte, gte } from 'drizzle-orm'
import { addDays, type IsoDate, startOfWeek, type Weekday } from '../../shared/dates'
import type { TimeEntry, TimeInput, TimeProject, TimeWeek } from '../../shared/work'
import type { Actor } from '../access/actor'
import { ownId } from '../access/decisions'
import { invalidInput } from '../api/input'
import { lockTimeEntryForEdit } from '../billing'
import { todayIn } from '../clock'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx } from '../db'
import { clients, people, projectMembers, projects, projectTasks, submissions, tasks, timeEntries } from '../db/schema'
import { ApiError } from '../errors'
import { getSettings } from '../people/lookup'
import { currentMembership, isCurrentMembership } from '../people/membership'
import { selectTime, type TimeRow } from './figures'

/** Today, where the person is. */
export async function todayOf(db: Db | Tx, personId: number, now: Date): Promise<IsoDate> {
  const [person] = await db.select({ timeZone: people.timeZone }).from(people).where(eq(people.id, personId))
  return todayIn(person?.timeZone ?? (await getSettings(db)).timeZone, now)
}

/** Whether a date can no longer be changed, because its period is closed or its week was handed in. */
export async function closedOn(db: Db | Tx, personId: number, from: IsoDate, to: IsoDate, today: IsoDate): Promise<(date: IsoDate) => boolean> {
  const { lockedThrough, lockAfterDays, weekStartsOn } = await getSettings(db)
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
    if (lockedThrough !== null && date <= lockedThrough) return true
    const weekEnd = addDays(startOfWeek(date, weekStartsOn as Weekday), 6)
    if (lockAfterDays !== null && addDays(weekEnd, lockAfterDays) < today) return true
    return handedIn.some(({ start, end }) => date >= start && date <= end)
  }
}

export const toEntry =
  (isClosed: (date: IsoDate) => boolean) =>
  (row: TimeRow): TimeEntry => ({
    id: row.id, version: row.version, projectId: row.projectId, project: row.project, client: row.client, taskId: row.taskId, task: row.task,
    spentOn: row.spentOn, minutes: row.minutes, timerStartedAt: row.timerStartedAt?.toISOString() ?? null, notes: row.notes,
    billable: row.billable, status: row.status,
    locked: row.invoiceLineId !== null ? 'invoiced' : row.status === 'approved' ? 'approved' : isClosed(row.spentOn) ? 'period' : null,
  })

export async function readRunning(db: Db, personId: number): Promise<TimeEntry | null> {
  const [row] = await selectTime(db).where(and(eq(timeEntries.personId, personId), isNotNull(timeEntries.timerStartedAt)))
  return row ? toEntry(() => false)(row) : null
}

/** A week of one's own time; the current one without a date. */
export async function readWeek(ctx: AppContext, actor: Actor, date: IsoDate | null): Promise<TimeWeek> {
  const personId = ownId(actor)
  const { db } = ctx
  const now = ctx.now()
  const today = await todayOf(db, personId, now)
  const { weekStartsOn } = await getSettings(db)
  const from = startOfWeek(date ?? today, weekStartsOn as Weekday)
  const to = addDays(from, 6)
  const rows = await selectTime(db)
    .where(and(eq(timeEntries.personId, personId), between(timeEntries.spentOn, from, to)))
    .orderBy(asc(timeEntries.spentOn), asc(timeEntries.id))
  const [person] = await db.select({ capacity: people.weeklyCapacityMinutes }).from(people).where(eq(people.id, personId))
  return {
    from, to, today, capacityMinutes: person?.capacity ?? 0,
    entries: rows.map(toEntry(await closedOn(db, personId, from, to, today))),
    running: await readRunning(db, personId),
    now: now.toISOString(),
  }
}

/** The projects and tasks that time can be entered on. */
export async function readTimeOptions(db: Db, actor: Actor): Promise<{ projects: TimeProject[] }> {
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
    .where(and(eq(projectMembers.personId, ownId(actor)), isCurrentMembership(), isNull(projects.archivedAt), isNull(clients.archivedAt)))
    .orderBy(asc(clients.name), asc(projects.name), desc(projectTasks.billable), asc(tasks.name))
  const found = new Map<number, TimeProject>()
  for (const { id, name, code, client, taskId, task, billable, type } of rows) {
    const project = found.get(id) ?? { id, name, code, client, tasks: [] }
    project.tasks.push({ id: taskId, name: task, billable: billable && type !== 'non_billable' })
    found.set(id, project)
  }
  return { projects: [...found.values()] }
}

const periodClosed = () => new ApiError(409, 'period_closed', 'This week was handed in or is closed. It cannot be changed.')

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

export async function createEntry(ctx: AppContext, actor: Actor, input: TimeInput, start: boolean): Promise<void> {
  const personId = ownId(actor)
  await runTransaction(ctx.db, async (tx) => {
    await checkOpen(tx, personId, input.spentOn, ctx.now())
    const billable = await checkTask(tx, personId, input.projectId, input.taskId)
    if (start) await stopRunning(tx, personId, ctx.now())
    await tx.insert(timeEntries).values({ ...input, personId, billable, createdBy: personId, timerStartedAt: start ? ctx.now() : null })
  })
}

export async function updateEntry(ctx: AppContext, actor: Actor, id: number, { version, ...input }: TimeInput & { version: number }): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const entry = await lockTimeEntryForEdit(tx, actor, id, version, { projectId: input.projectId })
    await checkOpen(tx, entry.personId, entry.spentOn, ctx.now())
    await checkOpen(tx, entry.personId, input.spentOn, ctx.now())
    const moved = entry.projectId !== input.projectId || entry.taskId !== input.taskId
    const billable = moved ? await checkTask(tx, entry.personId, input.projectId, input.taskId) : entry.billable
    await tx.update(timeEntries).set({ ...input, billable }).where(eq(timeEntries.id, id))
  })
}

export async function deleteEntry(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const entry = await lockTimeEntryForEdit(tx, actor, id, version)
    await checkOpen(tx, entry.personId, entry.spentOn, ctx.now())
    await tx.delete(timeEntries).where(eq(timeEntries.id, id))
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
