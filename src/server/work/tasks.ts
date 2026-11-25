/** The company's task library. */
import { and, asc, countDistinct, eq, isNull, sql } from 'drizzle-orm'
import type { TaskRow } from '../../shared/work'
import type { Actor } from '../access/actor'
import { requirePermission } from '../access/decisions'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { type Db, runTransaction } from '../db'
import { projects, projectTasks, tasks } from '../db/schema'

export async function listTasks(db: Db, actor: Actor): Promise<TaskRow[]> {
  requirePermission(actor, 'tasks.manage', 'all')
  const rows = await db.select().from(tasks).orderBy(asc(sql`lower(${tasks.name})`))
  const used = await db
    .select({ id: projectTasks.taskId, projects: countDistinct(projectTasks.projectId) })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(and(isNull(projectTasks.removedAt), isNull(projects.archivedAt)))
    .groupBy(projectTasks.taskId)
  return rows.map(({ id, name, billableByDefault, common, archivedAt }) => ({
    id, name, billable: billableByDefault, common, archived: archivedAt !== null, projects: used.find((row) => row.id === id)?.projects ?? 0,
  }))
}

export async function createTask(ctx: AppContext, actor: Actor, { name, billable, common }: { name: string; billable: boolean; common: boolean }): Promise<void> {
  requirePermission(actor, 'tasks.manage', 'all')
  await runTransaction(ctx.db, async (tx) => {
    const same = await tx.select({ id: tasks.id }).from(tasks).where(eq(sql`lower(${tasks.name})`, name.toLowerCase()))
    if (same.length > 0) throw invalidInput({ name: 'There is already a task with this name.' })
    await tx.insert(tasks).values({ name, billableByDefault: billable, common })
  })
}
