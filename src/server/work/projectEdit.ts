/** Changing projects: settings, tasks, team, and what becomes of them. */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { BudgetType, ProjectType, RateMethod } from '../../shared/domain'
import type { IsoDate } from '../../shared/dates'
import { type Actor, loadActor, readPersonAccess } from '../access/actor'
import { can, forbidden, ownId, requirePermission, requireRecord } from '../access/decisions'
import { setManagerFlag } from '../access/managerFlags'
import { lockForAccessChange } from '../access/grants'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { runTransaction, type Tx, updateVersioned } from '../db'
import {
  assignments, clients, estimateLines, estimates, expenses, inviteProjects, invoiceLines, personClients, projectMembers, projectPins, projects, projectTags,
  projectTasks, recurringInvoiceLines, retainers, tags, tasks, timeEntries,
} from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { differences, holdClient, holdPerson, holdProject, logChange, namedIds } from './common'
import { readProject } from './projects'

export interface ProjectInput {
  version: number
  name: string
  code: string
  startsOn: IsoDate | null
  endsOn: IsoDate | null
  notes: string
  tags: string[]
  budgetMinutes: number | null
  budgetMonthly: boolean
  budgetIncludesExpenses: boolean
  budgetVisibleToAll: boolean
  budgetAlertPercent: number | null
  /** The rest only for those who may change rates. */
  type: ProjectType
  rateMethod: RateMethod
  rate: number | null
  fixedFee: number | null
  budgetType: BudgetType
  budgetAmount: number | null
}

const feeBudgets: BudgetType[] = ['total_fees', 'fees_per_task']

/** The project, locked, for someone who may edit it. */
async function lockForEdit(tx: Tx, actor: Actor, id: number, { archived = false } = {}) {
  requireRecord(actor, { view: 'projects.view', action: 'projects.edit' }, { type: 'project', projectId: id }, id)
  const project = await holdProject(tx, id, 'change')
  if (project.archivedAt !== null && !archived) throw new ApiError(409, 'project_archived', 'This project is archived. Restore it first.')
  return project
}

async function saveTags(tx: Tx, projectId: number, names: string[]): Promise<void> {
  const ids = await namedIds(tx, tags, names)
  await tx.delete(projectTags).where(eq(projectTags.projectId, projectId))
  if (ids.length > 0) await tx.insert(projectTags).values(ids.map((tagId) => ({ projectId, tagId })))
}

export async function updateProject(ctx: AppContext, actor: Actor, id: number, { version, tags: tagNames, ...input }: ProjectInput): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const before = await lockForEdit(tx, actor, id)
    await holdClient(tx, before.clientId, 'use')
    const mayMoney = can(actor, 'billable.edit', { type: 'project', projectId: id })
    const { type: _type, rateMethod: _method, rate: _rate, fixedFee: _fee, budgetAmount: _amount, budgetType, ...plain } = input
    // Who may not see or change amounts leaves them as they are, whatever was sent.
    const { type, rateMethod, rate, fixedFee, budgetAmount } = mayMoney ? input : before
    const budgetKindChanged = budgetType !== before.budgetType && (feeBudgets.includes(budgetType) || feeBudgets.includes(before.budgetType))
    if (!mayMoney && budgetKindChanged) throw forbidden()
    if (input.startsOn !== null && input.endsOn !== null && input.endsOn < input.startsOn) throw invalidInput({ endsOn: 'The end is before the start.' })
    if (type === 'fixed_fee' && fixedFee === null) throw invalidInput({ fixedFee: 'Enter the fee.' })
    if (type === 'time_materials' && rateMethod === 'project' && rate === null) throw invalidInput({ rate: 'Enter the rate.' })
    if (budgetType === 'total_hours' && !plain.budgetMinutes) throw invalidInput({ budgetMinutes: 'Enter the hours.' })
    if (budgetType === 'total_fees' && !budgetAmount) throw invalidInput({ budgetAmount: 'Enter the amount.' })
    const after = {
      ...plain, type, rateMethod: type === 'non_billable' ? ('none' as const) : rateMethod, rate: type !== 'non_billable' && rateMethod === 'project' ? rate : null,
      fixedFee: type === 'fixed_fee' ? fixedFee : null, budgetType, budgetAmount: budgetType === 'total_fees' ? budgetAmount : null,
      budgetMinutes: budgetType === 'total_hours' ? plain.budgetMinutes : null,
    }
    await updateVersioned(tx, projects, id, version, after)
    if (type === 'non_billable') await tx.update(projectTasks).set({ billable: false }).where(eq(projectTasks.projectId, id))
    await saveTags(tx, id, tagNames)
    await logChange(tx, actor, { action: 'updated', type: 'project', id, summary: `Changed project ${input.name}`, changes: differences(before, after) })
  })
}

export interface ProjectTaskInput {
  taskId: number
  billable: boolean
  rate: number | null
  budgetMinutes: number | null
  budgetAmount: number | null
}

/** The tasks as they are to be. Those left out are taken off, and keep their time. */
export async function saveProjectTasks(ctx: AppContext, actor: Actor, id: number, wanted: ProjectTaskInput[]): Promise<void> {
  if (new Set(wanted.map(({ taskId }) => taskId)).size < wanted.length) throw invalidInput({ tasks: 'A task is chosen twice.' })
  await runTransaction(ctx.db, async (tx) => {
    const project = await lockForEdit(tx, actor, id)
    await holdClient(tx, project.clientId, 'use')
    const mayMoney = can(actor, 'billable.edit', { type: 'project', projectId: id })
    const there = await tx.select().from(projectTasks).where(eq(projectTasks.projectId, id))
    const fresh = wanted.filter(({ taskId }) => !there.some((row) => row.taskId === taskId && row.removedAt === null)).map(({ taskId }) => taskId)
    if (fresh.length > 0) {
      const known = await tx.select({ id: tasks.id }).from(tasks).where(and(inArray(tasks.id, fresh), isNull(tasks.archivedAt)))
      if (known.length < fresh.length) throw invalidInput({ tasks: 'Choose tasks from the list.' })
    }
    for (const { taskId, billable, budgetMinutes, rate, budgetAmount } of wanted) {
      const row = there.find((candidate) => candidate.taskId === taskId)
      // Who may not see amounts sends none: what is stored stays.
      const amounts = mayMoney ? { rate, budgetAmount } : {}
      const values = { billable: billable && project.type !== 'non_billable', budgetMinutes, ...amounts, removedAt: null }
      if (row) await tx.update(projectTasks).set(values).where(eq(projectTasks.id, row.id))
      else await tx.insert(projectTasks).values({ projectId: id, taskId, ...values })
    }
    const gone = there.filter((row) => row.removedAt === null && !wanted.some(({ taskId }) => taskId === row.taskId))
    if (gone.length > 0) await tx.update(projectTasks).set({ removedAt: ctx.now() }).where(inArray(projectTasks.id, gone.map((row) => row.id)))
    await logChange(tx, actor, { action: 'updated', type: 'project', id, summary: `Changed the tasks of ${project.name}` })
  })
}

export interface ProjectMemberInput {
  personId: number
  rate: number | null
  budgetMinutes: number | null
  isManager: boolean
}

/** The team as it is to be. */
export async function saveProjectTeam(ctx: AppContext, actor: Actor, id: number, wanted: ProjectMemberInput[]): Promise<void> {
  if (new Set(wanted.map(({ personId }) => personId)).size < wanted.length) throw invalidInput({ members: 'A person is chosen twice.' })
  await runTransaction(ctx.db, async (tx) => {
    const there = await tx.select().from(projectMembers).where(eq(projectMembers.projectId, id))
    const current = there.filter((row) => row.removedAt === null)
    const concerned = [...new Set([...wanted.map(({ personId }) => personId), ...current.map(({ personId }) => personId)])]
    const editor = await lockForAccessChange(tx, actor, { people: concerned })
    const project = await lockForEdit(tx, editor, id)
    await holdClient(tx, project.clientId, 'use')
    const mayMoney = can(editor, 'billable.edit', { type: 'project', projectId: id })
    const access = async (personId: number) => {
      const found = await readPersonAccess(tx, personId)
      if (!found) throw new NotFoundError(personId)
      return found
    }
    const gone = current.filter((row) => !wanted.some(({ personId }) => personId === row.personId))
    for (const row of gone) {
      // Taking a manager off ends what they may do.
      if (row.isManager) await setManagerFlag(tx, editor, await access(row.personId), id, false)
      await tx.update(projectMembers).set({ removedAt: ctx.now(), isManager: false }).where(eq(projectMembers.id, row.id))
    }
    for (const { personId, rate, budgetMinutes, isManager } of wanted) {
      const row = there.find((candidate) => candidate.personId === personId)
      const values = { budgetMinutes, ...(mayMoney && { rate }), removedAt: null }
      const isCurrent = row !== undefined && row.removedAt === null
      if (!isCurrent) await holdPerson(tx, personId, 'use')
      if (row) await tx.update(projectMembers).set(isCurrent ? values : { ...values, isManager: false }).where(eq(projectMembers.id, row.id))
      else await tx.insert(projectMembers).values({ projectId: id, personId, ...values })
      await tx.insert(personClients).values({ personId, clientId: project.clientId }).onConflictDoNothing()
      if ((isCurrent && row.isManager) !== isManager) await setManagerFlag(tx, editor, await access(personId), id, isManager)
    }
    await logChange(tx, actor, {
      action: 'updated', type: 'project', id, summary: `Changed the team of ${project.name}`,
      changes: { people: [current.map(({ personId }) => personId), wanted.map(({ personId }) => personId)] },
    })
  })
}

export async function archiveProject(ctx: AppContext, actor: Actor, id: number, archive: boolean): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const project = await lockForEdit(tx, actor, id, { archived: true })
    if ((project.archivedAt !== null) === archive) return
    if (!archive) await holdClient(tx, project.clientId, 'use')
    await tx.update(projects).set({ archivedAt: archive ? ctx.now() : null }).where(eq(projects.id, id))
    await logChange(tx, actor, { action: archive ? 'archived' : 'restored', type: 'project', id, summary: `${archive ? 'Archived' : 'Restored'} project ${project.name}` })
  })
}

export async function deleteProject(ctx: AppContext, actor: Actor, id: number): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const project = await lockForEdit(tx, actor, id, { archived: true })
    const uses: [string, number][] = [
      ['time', await tx.$count(timeEntries, eq(timeEntries.projectId, id))], ['expenses', await tx.$count(expenses, eq(expenses.projectId, id))],
      ['invoices', await tx.$count(invoiceLines, eq(invoiceLines.projectId, id))],
      ['estimates', (await tx.$count(estimates, eq(estimates.projectId, id))) + (await tx.$count(estimateLines, eq(estimateLines.projectId, id)))],
      ['recurring invoices', await tx.$count(recurringInvoiceLines, eq(recurringInvoiceLines.projectId, id))],
      ['retainers', await tx.$count(retainers, eq(retainers.projectId, id))], ['planned work', await tx.$count(assignments, eq(assignments.projectId, id))],
    ]
    const found = uses.filter(([, count]) => count > 0).map(([name]) => name)
    if (found.length > 0) throw new ApiError(409, 'project_in_use', `This project has ${found.join(', ')}. Archive it instead.`)
    await tx.delete(inviteProjects).where(eq(inviteProjects.projectId, id))
    await tx.delete(projects).where(eq(projects.id, id))
    await logChange(tx, actor, { action: 'deleted', type: 'project', id, summary: `Deleted project ${project.name}` })
  })
}

export async function pinProject(ctx: AppContext, actor: Actor, id: number, pin: boolean): Promise<void> {
  const personId = ownId(actor)
  // Only what one may open.
  await readProject(ctx, actor, id)
  if (pin) await ctx.db.insert(projectPins).values({ personId, projectId: id }).onConflictDoNothing()
  else await ctx.db.delete(projectPins).where(and(eq(projectPins.personId, personId), eq(projectPins.projectId, id)))
}

export interface DuplicateInput {
  clientId: number
  name: string
  code: string
  withTeam: boolean
}

/** A copy with settings, tasks and budget, and without any work. */
export async function duplicateProject(ctx: AppContext, actor: Actor, id: number, { clientId, name, code, withTeam }: DuplicateInput): Promise<number> {
  requirePermission(actor, 'projects.create')
  requireRecord(actor, { view: 'projects.view', action: 'projects.edit' }, { type: 'project', projectId: id }, id)
  const creator = ownId(actor)
  return runTransaction(ctx.db, async (tx) => {
    const client = await holdClient(tx, clientId, 'use')
    const [original] = await tx.select({ project: projects, currency: clients.currency }).from(projects).innerJoin(clients, eq(clients.id, projects.clientId)).where(eq(projects.id, id))
    if (!original) throw new NotFoundError(id)
    const { id: _id, createdAt: _c, updatedAt: _u, version: _v, archivedAt: _a, ...settings } = original.project
    const keepMoney = original.currency === client.currency && can(actor, 'billable.edit', { type: 'project', projectId: id })
    const money = keepMoney
      ? {}
      : { rate: null, fixedFee: null, budgetAmount: null, type: settings.type === 'fixed_fee' ? ('time_materials' as const) : settings.type,
          rateMethod: settings.type === 'non_billable' ? ('none' as const) : ('person' as const), budgetType: feeBudgets.includes(settings.budgetType) ? ('none' as const) : settings.budgetType }
    const [copy] = await tx.insert(projects).values({ ...settings, ...money, clientId, name, code, startsOn: null, endsOn: null }).returning({ id: projects.id })
    if (!copy) throw new Error('The project was not stored.')
    const rows = await tx
      .select({ row: projectTasks, archivedAt: tasks.archivedAt })
      .from(projectTasks)
      .innerJoin(tasks, eq(tasks.id, projectTasks.taskId))
      .where(and(eq(projectTasks.projectId, id), isNull(projectTasks.removedAt)))
    const usable = rows.filter(({ archivedAt }) => archivedAt === null)
    if (usable.length > 0) {
      await tx.insert(projectTasks).values(
        usable.map(({ row }) => ({
          projectId: copy.id, taskId: row.taskId, billable: row.billable, budgetMinutes: row.budgetMinutes,
          rate: keepMoney ? row.rate : null, budgetAmount: keepMoney ? row.budgetAmount : null,
        })),
      )
    }
    await tx.insert(projectMembers).values({ projectId: copy.id, personId: creator, isManager: true })
    if (withTeam) {
      const team = await tx.select().from(projectMembers).where(and(eq(projectMembers.projectId, id), isNull(projectMembers.removedAt)))
      for (const member of team) {
        if (member.personId === creator) continue
        const person = await loadActor(tx, member.personId)
        if (!person.active) continue
        await tx.insert(projectMembers).values({
          projectId: copy.id, personId: member.personId, budgetMinutes: member.budgetMinutes, rate: keepMoney ? member.rate : null,
        })
        await tx.insert(personClients).values({ personId: member.personId, clientId }).onConflictDoNothing()
      }
    }
    await logChange(tx, actor, { action: 'created', type: 'project', id: copy.id, summary: `Created project ${name} as a copy of ${original.project.name}` })
    return copy.id
  })
}
