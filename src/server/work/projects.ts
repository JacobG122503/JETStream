/** Projects: what people see of them, and making new ones. */
import { and, asc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { addDays, type IsoDate, startOfWeek, type Weekday } from '../../shared/dates'
import type { ProjectType, RateMethod } from '../../shared/domain'
import type { Budget, ProjectDetails, ProjectOptions, ProjectRow, WeekPoint } from '../../shared/work'
import type { Actor } from '../access/actor'
import { can, forbidden, holds, ownId, requirePermission } from '../access/decisions'
import { visibleFields } from '../access/fields'
import { filterFor } from '../access/filters'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx } from '../db'
import { clients, expenses, people, projectMembers, projects, projectTasks, tasks, timeEntries } from '../db/schema'
import { NotFoundError } from '../errors'
import { getSettings } from '../people/lookup'
import { isCurrentMembership } from '../people/membership'
import { groupRows, isUnbilled, loadValued, sumBy, type Valued } from './figures'
import { todayOf } from './time'

type Project = typeof projects.$inferSelect

/** Projects the person is on, and those they may see otherwise. */
function visibleProjects(db: Db, actor: Actor): SQL | undefined {
  const mine = db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.personId, ownId(actor)), isCurrentMembership()))
  return holds(actor, 'projects.view', 'all') ? undefined : or(inArray(projects.id, mine), filterFor(db, actor, 'projects.view', 'project'))
}

const inMonth = (date: IsoDate, today: IsoDate) => date.slice(0, 7) === today.slice(0, 7)

/** Minutes or fees used of the project's budget. Fees only for those who may see them. */
function budgetOf(project: Project, time: readonly Valued[], spent: number, parts: { minutes: number; amount: number }, seen: { hours: boolean; fees: boolean }, today: IsoDate): Budget | null {
  const counted = project.budgetMonthly ? time.filter(({ spentOn }) => inMonth(spentOn, today)) : time
  const common = { monthly: project.budgetMonthly, alertPercent: project.budgetAlertPercent }
  const hours = (total: number): Budget | null =>
    seen.hours && total > 0 ? { unit: 'hours', used: sumBy(counted, ({ worked }) => worked), total, ...common } : null
  // Fixed-fee work is not billed by the hour, so its value is not known here.
  const fees = (total: number): Budget | null =>
    seen.fees && total > 0 && project.type !== 'fixed_fee'
      ? { unit: 'fees', used: sumBy(counted, ({ amount }) => amount ?? 0) + (project.budgetIncludesExpenses ? spent : 0), total, ...common }
      : null
  switch (project.budgetType) {
    case 'none':
      return null
    case 'total_hours':
      return hours(project.budgetMinutes ?? 0)
    case 'hours_per_task':
    case 'hours_per_person':
      return hours(parts.minutes)
    case 'total_fees':
      return fees(project.budgetAmount ?? 0)
    case 'fees_per_task':
      return fees(parts.amount)
  }
}

interface Loaded {
  project: Project
  client: typeof clients.$inferSelect
  time: Valued[]
  members: { personId: number; name: string; photoId: number | null; isManager: boolean; budgetMinutes: number | null }[]
  taskRows: { id: number; name: string; billable: boolean; budgetMinutes: number | null; budgetAmount: number | null; removed: boolean }[]
  /** Billable expenses. */
  spent: number
}

async function loadProjects(db: Db, condition: SQL | undefined): Promise<Loaded[]> {
  const rows = await db
    .select({ project: projects, client: clients })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(condition)
    .orderBy(asc(clients.name), asc(projects.name))
  const ids = rows.map(({ project }) => project.id)
  if (ids.length === 0) return []
  const time = groupRows(await loadValued(db, inArray(timeEntries.projectId, ids)), ({ projectId }) => projectId)
  const members = groupRows(
    await db
      .select({
        projectId: projectMembers.projectId, personId: people.id, name: people.name, photoId: people.photoFileId,
        isManager: projectMembers.isManager, budgetMinutes: projectMembers.budgetMinutes,
      })
      .from(projectMembers)
      .innerJoin(people, eq(people.id, projectMembers.personId))
      .where(and(inArray(projectMembers.projectId, ids), isCurrentMembership()))
      .orderBy(asc(people.name)),
    ({ projectId }) => projectId,
  )
  const taskRows = groupRows(
    await db
      .select({
        projectId: projectTasks.projectId, id: tasks.id, name: tasks.name, billable: projectTasks.billable,
        budgetMinutes: projectTasks.budgetMinutes, budgetAmount: projectTasks.budgetAmount, removedAt: projectTasks.removedAt,
      })
      .from(projectTasks)
      .innerJoin(tasks, eq(tasks.id, projectTasks.taskId))
      .where(inArray(projectTasks.projectId, ids))
      .orderBy(asc(tasks.name)),
    ({ projectId }) => projectId,
  )
  const spent = groupRows(
    await db.select({ projectId: expenses.projectId, amount: expenses.amount }).from(expenses).where(and(inArray(expenses.projectId, ids), eq(expenses.billable, true))),
    ({ projectId }) => projectId,
  )
  return rows.map(({ project, client }) => ({
    project, client, time: time.get(project.id) ?? [], members: members.get(project.id) ?? [],
    taskRows: (taskRows.get(project.id) ?? []).map(({ removedAt, ...row }) => ({ ...row, removed: removedAt !== null })),
    spent: sumBy(spent.get(project.id) ?? [], ({ amount }) => amount),
  }))
}

function toRow(actor: Actor, loaded: Loaded, today: IsoDate): ProjectRow {
  const { project, client, time, members, taskRows, spent } = loaded
  const facts = { type: 'project', projectId: project.id } as const
  const budgetParts: readonly { budgetMinutes: number | null }[] = project.budgetType === 'hours_per_person' ? members : taskRows
  const parts = {
    minutes: sumBy(budgetParts, ({ budgetMinutes }) => budgetMinutes ?? 0),
    amount: sumBy(taskRows, ({ budgetAmount }) => budgetAmount ?? 0),
  }
  const seen = {
    hours: can(actor, 'projects.view', facts) || project.budgetVisibleToAll,
    fees: can(actor, 'billable.view', facts) && can(actor, 'projects.view', facts),
  }
  const total = seen.hours ? time : time.filter(({ personId }) => personId === ownId(actor))
  return {
    id: project.id, name: project.name, code: project.code, client: { id: client.id, name: client.name }, currency: client.currency,
    type: project.type, startsOn: project.startsOn, endsOn: project.endsOn, archived: project.archivedAt !== null || client.archivedAt !== null,
    minutes: sumBy(total, ({ worked }) => worked),
    billableMinutes: sumBy(total.filter(({ billable }) => billable), ({ worked }) => worked),
    budget: budgetOf(project, time, spent, parts, seen, today),
    members: members.map(({ personId, name, photoId, isManager }) => ({ id: personId, name, photoId, isManager })),
  }
}

export async function listProjects(ctx: AppContext, actor: Actor, condition?: SQL): Promise<ProjectRow[]> {
  const loaded = await loadProjects(ctx.db, and(visibleProjects(ctx.db, actor), condition))
  const today = await todayOf(ctx.db, ownId(actor), ctx.now())
  return loaded.map((project) => toRow(actor, project, today))
}

/** Hours per week, up to this week. */
export function weeksOf(time: readonly { spentOn: IsoDate; worked: number; billable: boolean }[], today: IsoDate, weekStart: Weekday, count: number): WeekPoint[] {
  const current = startOfWeek(today, weekStart)
  return Array.from({ length: count }, (_, index) => {
    const from = addDays(current, (index - count + 1) * 7)
    const rows = time.filter(({ spentOn }) => spentOn >= from && spentOn <= addDays(from, 6))
    const billable = sumBy(rows.filter((row) => row.billable), ({ worked }) => worked)
    return { from, billable, other: sumBy(rows, ({ worked }) => worked) - billable }
  })
}

export async function readProject(ctx: AppContext, actor: Actor, id: number): Promise<ProjectDetails> {
  const { db } = ctx
  const [loaded] = await loadProjects(db, and(eq(projects.id, id), visibleProjects(db, actor)))
  if (!loaded) throw new NotFoundError(id)
  const { project, time, members, taskRows } = loaded
  const facts = { type: 'project', projectId: id } as const
  const today = await todayOf(db, ownId(actor), ctx.now())
  const { weekStartsOn } = await getSettings(db)
  // Who is only a member sees their own work on it.
  const whole = can(actor, 'projects.view', facts)
  const shown = whole ? time : time.filter(({ personId }) => personId === ownId(actor))
  const worked = (rows: readonly Valued[]) => sumBy(rows, (row) => row.worked)
  const value = (rows: readonly Valued[]) => sumBy(rows, (row) => row.amount ?? 0)
  const past = [...groupRows(shown, ({ personId }) => personId)].filter(([personId]) => !members.some((member) => member.personId === personId))

  const details: ProjectDetails = {
    ...toRow(actor, loaded, today),
    notes: project.notes, rateMethod: project.rateMethod, budgetType: project.budgetType,
    weeks: weeksOf(shown, today, weekStartsOn as Weekday, 12),
    tasks: taskRows
      .filter(({ id: taskId, removed }) => !removed || shown.some((row) => row.taskId === taskId))
      .map(({ id: taskId, name, billable, budgetMinutes }) => {
        const rows = shown.filter((row) => row.taskId === taskId)
        return { id: taskId, name, billable, minutes: worked(rows), budgetMinutes: whole ? budgetMinutes : null, billableAmount: value(rows) }
      })

      .sort((a, b) => b.minutes - a.minutes),
    people: [
      ...members.map(({ personId, name, photoId, isManager, budgetMinutes }) => {
        const rows = shown.filter((row) => row.personId === personId)
        return { id: personId, name, photoId, isManager, minutes: worked(rows), budgetMinutes: whole ? budgetMinutes : null, billableAmount: value(rows) }
      }),
      ...past.map(([personId, rows]) => ({
        id: personId, name: rows[0]?.person ?? '', photoId: null, isManager: false, minutes: worked(rows), budgetMinutes: null, billableAmount: value(rows),
      })),
    ].sort((a, b) => b.minutes - a.minutes),
    billableAmount: value(shown),
    unbilledAmount: value(shown.filter(isUnbilled)),
    fixedFee: project.fixedFee,
    rate: project.rate,
  }
  return visibleFields(actor, facts, details) as ProjectDetails
}

export async function readProjectOptions(db: Db, actor: Actor): Promise<ProjectOptions> {
  requirePermission(actor, 'projects.create')
  const active = await db.select({ id: people.id, name: people.name }).from(people).where(eq(people.status, 'active')).orderBy(asc(people.name))
  return {
    clients: await db.select({ id: clients.id, name: clients.name, currency: clients.currency }).from(clients).where(isNull(clients.archivedAt)).orderBy(asc(clients.name)),
    tasks: (await db.select().from(tasks).where(isNull(tasks.archivedAt)).orderBy(asc(tasks.name))).map(({ id, name, common, billableByDefault }) => ({ id, name, common, billable: billableByDefault })),
    people: active,
    money: holds(actor, 'billable.edit', 'all'),
  }
}

export interface NewProject {
  clientId: number
  name: string
  code: string
  type: ProjectType
  /** Per hour, for work billed by one rate of the project; null for people's own rates. */
  rate: number | null
  fixedFee: number | null
  /** Total hours; null for no budget. */
  budgetMinutes: number | null
  taskIds: number[]
  personIds: number[]
}

/** The one who makes a project manages it. */
export async function createProject(ctx: AppContext, actor: Actor, input: NewProject): Promise<number> {
  requirePermission(actor, 'projects.create')
  const creator = ownId(actor)
  const { clientId, name, code, type, rate, fixedFee, budgetMinutes, taskIds, personIds } = input
  if ((rate !== null || fixedFee !== null) && !holds(actor, 'billable.edit', 'all')) throw forbidden()
  if (type === 'fixed_fee' && fixedFee === null) throw invalidInput({ fixedFee: 'Enter the fee.' })
  if (taskIds.length === 0) throw invalidInput({ taskIds: 'Choose at least one task.' })
  return runTransaction(ctx.db, async (tx: Tx) => {
    const [client] = await tx.select().from(clients).where(and(eq(clients.id, clientId), isNull(clients.archivedAt)))
    if (!client) throw invalidInput({ clientId: 'Choose a client.' })
    const chosenTasks = await tx.select().from(tasks).where(and(inArray(tasks.id, taskIds), isNull(tasks.archivedAt)))
    if (chosenTasks.length < taskIds.length) throw invalidInput({ taskIds: 'Choose tasks from the list.' })
    const team = [...new Set([creator, ...personIds])]
    const chosenPeople = await tx.select({ id: people.id }).from(people).where(and(inArray(people.id, team), eq(people.status, 'active')))
    if (chosenPeople.length < team.length) throw invalidInput({ personIds: 'Choose active people from the list.' })
    const rateMethod: RateMethod = type !== 'time_materials' ? 'none' : rate !== null ? 'project' : 'person'
    const [project] = await tx
      .insert(projects)
      .values({
        clientId, name, code, type, rateMethod, rate: rateMethod === 'project' ? rate : null, fixedFee: type === 'fixed_fee' ? fixedFee : null,
        budgetType: budgetMinutes === null ? 'none' : 'total_hours', budgetMinutes, budgetAlertPercent: budgetMinutes === null ? null : 80_000,
      })
      .returning({ id: projects.id })
    if (!project) throw new Error('The project was not stored.')
    await tx.insert(projectTasks).values(
      chosenTasks.map((task) => ({ projectId: project.id, taskId: task.id, billable: type !== 'non_billable' && task.billableByDefault })),
    )
    await tx.insert(projectMembers).values(team.map((personId) => ({ projectId: project.id, personId, isManager: personId === creator })))
    return project.id
  })
}
