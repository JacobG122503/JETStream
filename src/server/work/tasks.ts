/** The company's task library. */
import { and, asc, countDistinct, eq, isNull, ne, sql } from 'drizzle-orm'
import type { TaskRow } from '../../shared/work'
import type { Actor } from '../access/actor'
import { can, forbidden, holds, requirePermission } from '../access/decisions'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx, updateVersioned } from '../db'
import { assignments, projects, projectTasks, tasks } from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { differences, logChange } from './common'

export async function listTasks(db: Db, actor: Actor): Promise<TaskRow[]> {
  requirePermission(actor, 'tasks.manage', 'all')
  const money = holds(actor, 'billable.view', 'all')
  const rows = await db.select().from(tasks).orderBy(asc(sql`lower(${tasks.name})`))
  const used = await db
    .select({ id: projectTasks.taskId, projects: countDistinct(projectTasks.projectId) })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(and(isNull(projectTasks.removedAt), isNull(projects.archivedAt)))
    .groupBy(projectTasks.taskId)
  return rows.map(({ id, version, name, billableByDefault, defaultRate, common, archivedAt }) => ({
    id, version, name, billable: billableByDefault, common, archived: archivedAt !== null, projects: used.find((row) => row.id === id)?.projects ?? 0,
    ...(money && { defaultRate }),
  }))
}

export interface TaskInput {
  name: string
  billable: boolean
  common: boolean
  /** Left out by those who may not change rates. */
  defaultRate?: number | null
}

async function checkTask(tx: Tx, actor: Actor, { name, defaultRate }: TaskInput, before?: typeof tasks.$inferSelect) {
  const changesRate = defaultRate !== undefined && defaultRate !== (before?.defaultRate ?? null)
  if (changesRate && !holds(actor, 'billable.edit', 'all')) throw forbidden()
  const same = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(sql`lower(${tasks.name})`, name.toLowerCase()), ne(tasks.id, before?.id ?? 0)))
  if (same.length > 0) throw invalidInput({ name: 'There is already a task with this name.' })
}

const valuesOf = ({ name, billable, common, defaultRate }: TaskInput) => ({
  name, billableByDefault: billable, common, ...(defaultRate !== undefined && { defaultRate }),
})

export async function createTask(ctx: AppContext, actor: Actor, input: TaskInput): Promise<number> {
  requirePermission(actor, 'tasks.manage', 'all')
  return runTransaction(ctx.db, async (tx) => {
    await checkTask(tx, actor, input)
    const [task] = await tx.insert(tasks).values(valuesOf(input)).returning({ id: tasks.id })
    await logChange(tx, actor, { action: 'created', type: 'task', id: task?.id ?? null, summary: `Created task ${input.name}` })
    return task?.id ?? 0
  })
}

export async function updateTask(ctx: AppContext, actor: Actor, id: number, { version, ...input }: TaskInput & { version: number }): Promise<void> {
  requirePermission(actor, 'tasks.manage', 'all')
  await runTransaction(ctx.db, async (tx) => {
    const [before] = await tx.select().from(tasks).where(eq(tasks.id, id)).for('update')
    if (!before) throw new NotFoundError(id)
    await checkTask(tx, actor, input, before)
    await updateVersioned(tx, tasks, id, version, valuesOf(input))
    await logChange(tx, actor, { action: 'updated', type: 'task', id, summary: `Changed task ${input.name}`, changes: differences(before, valuesOf(input)) })
  })
}

export async function archiveTask(ctx: AppContext, actor: Actor, id: number, archive: boolean): Promise<void> {
  requirePermission(actor, 'tasks.manage', 'all')
  await runTransaction(ctx.db, async (tx) => {
    const [task] = await tx.update(tasks).set({ archivedAt: archive ? ctx.now() : null }).where(eq(tasks.id, id)).returning()
    if (!task) throw new NotFoundError(id)
    await logChange(tx, actor, { action: archive ? 'archived' : 'restored', type: 'task', id, summary: `${archive ? 'Archived' : 'Restored'} task ${task.name}` })
  })
}

export async function deleteTask(ctx: AppContext, actor: Actor, id: number): Promise<void> {
  requirePermission(actor, 'tasks.manage', 'all')
  await runTransaction(ctx.db, async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).for('update')
    if (!task) throw new NotFoundError(id)
    const used = (await tx.$count(projectTasks, eq(projectTasks.taskId, id))) + (await tx.$count(assignments, eq(assignments.taskId, id)))
    if (used > 0) throw new ApiError(409, 'task_in_use', 'Projects use this task. Archive it instead.')
    await tx.delete(tasks).where(eq(tasks.id, id))
    await logChange(tx, actor, { action: 'deleted', type: 'task', id, summary: `Deleted task ${task.name}` })
  })
}

/** Adds the task to every active project that does not have it and that the actor may edit. */
export async function addToAllProjects(ctx: AppContext, actor: Actor, id: number): Promise<number> {
  requirePermission(actor, 'tasks.manage', 'all')
  return runTransaction(ctx.db, async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).for('share')
    if (!task) throw new NotFoundError(id)
    if (task.archivedAt !== null) throw new ApiError(409, 'task_archived', 'This task is archived.')
    const all = await tx.select({ id: projects.id, type: projects.type }).from(projects).where(isNull(projects.archivedAt))
    const active = all.filter(({ id: projectId }) => can(actor, 'projects.edit', { type: 'project', projectId }))
    let added = 0
    for (const project of active) {
      const billable = task.billableByDefault && project.type !== 'non_billable'
      const [there] = await tx.select().from(projectTasks).where(and(eq(projectTasks.projectId, project.id), eq(projectTasks.taskId, id)))
      if (there && there.removedAt === null) continue
      if (there) await tx.update(projectTasks).set({ removedAt: null }).where(eq(projectTasks.id, there.id))
      else await tx.insert(projectTasks).values({ projectId: project.id, taskId: id, billable })
      added++
    }
    await logChange(tx, actor, { action: 'updated', type: 'task', id, summary: `Added task ${task.name} to ${added} projects` })
    return added
  })
}
