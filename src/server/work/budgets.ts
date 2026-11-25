/** Telling managers when a budget is used up to the percentage they set. Once for each project, period and percentage. */
import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm'
import { loadActor, type PersonActor } from '../access/actor'
import { holds } from '../access/decisions'
import { todayIn } from '../clock'
import type { AppContext } from '../context'
import { budgetAlerts, people, projectMembers, projects } from '../db/schema'
import { getSettings } from '../people/lookup'
import { isCurrentMembership } from '../people/membership'
import { notify } from './notify'
import { listProjects } from './projects'

const always = '0001-01-01'

export async function noteBudgetAlerts(ctx: AppContext): Promise<number> {
  const { db } = ctx
  const month = `${todayIn((await getSettings(db)).timeZone, ctx.now()).slice(0, 7)}-01`
  const watched = await db.select({ id: projects.id }).from(projects).where(and(isNull(projects.archivedAt), ne(projects.budgetType, 'none'), isNotNull(projects.budgetAlertPercent)))
  if (watched.length === 0) return 0
  const active = await db.select({ id: people.id }).from(people).where(eq(people.status, 'active'))
  const actors: PersonActor[] = []
  for (const { id } of active) actors.push(await loadActor(db, id))
  let alerts = 0
  for (const { id } of watched) {
    const managers = await db.select({ id: projectMembers.personId }).from(projectMembers).where(and(eq(projectMembers.projectId, id), eq(projectMembers.isManager, true), isCurrentMembership()))
    // The project's managers; without any, those who run everything. Only whoever sees the budget.
    const wanted = actors.filter((actor) => (managers.length > 0 ? managers.some((manager) => manager.id === actor.id) : holds(actor, 'projects.edit', 'all')))
    const told: number[] = []
    let words: { name: string; percent: number } | null = null
    let key: { periodStart: string; percent: number } | null = null
    for (const actor of wanted) {
      const [row] = await listProjects(ctx, actor, eq(projects.id, id))
      const budget = row?.budget
      if (!row || !budget || budget.alertPercent === null || budget.used * 100_000 < budget.total * budget.alertPercent) continue
      told.push(actor.id)
      words = { name: row.name, percent: Math.floor((budget.used / budget.total) * 100) }
      key = { periodStart: budget.monthly ? month : always, percent: budget.alertPercent }
    }
    if (!words || !key) continue
    const [first] = await db.insert(budgetAlerts).values({ projectId: id, ...key, sentAt: ctx.now() }).onConflictDoNothing().returning({ id: budgetAlerts.id })
    if (!first) continue
    alerts++
    await notify(ctx, told, { kind: 'budget', title: `${words.name}: ${words.percent}% of the budget is used`, body: `You asked to be told at ${key.percent / 1000}%.`, path: `/projects/${id}` })
  }
  return alerts
}
