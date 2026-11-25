/** One's own expenses. */
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { expenseAmount } from '../../shared/calc'
import type { ExpenseInput, ExpenseOptions, ExpenseRow } from '../../shared/work'
import type { Actor } from '../access/actor'
import { ownId } from '../access/decisions'
import { invalidInput } from '../api/input'
import { lockExpenseForEdit } from '../billing'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx } from '../db'
import { clients, expenseCategories, expenses, invoiceExpenses, projectMembers, projects } from '../db/schema'
import { ApiError } from '../errors'
import { currentMembership, isCurrentMembership } from '../people/membership'
import { closedOn, todayOf } from './time'

export async function listExpenses(ctx: AppContext, actor: Actor): Promise<ExpenseRow[]> {
  const { db } = ctx
  const personId = ownId(actor)
  const rows = await db
    .select({ expense: expenses, project: projects.name, client: clients.name, category: expenseCategories.name, lineId: invoiceExpenses.lineId })
    .from(expenses)
    .innerJoin(projects, eq(projects.id, expenses.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(invoiceExpenses, eq(invoiceExpenses.expenseId, expenses.id))
    .where(eq(expenses.personId, personId))
    .orderBy(desc(expenses.spentOn), desc(expenses.id))
  const dates = rows.map(({ expense }) => expense.spentOn)
  const today = await todayOf(db, personId, ctx.now())
  const isClosed = await closedOn(db, personId, dates.at(-1) ?? today, dates[0] ?? today, today)
  return rows.map(({ expense, project, client, category, lineId }) => ({
    id: expense.id, version: expense.version, projectId: expense.projectId, project, client, categoryId: expense.categoryId, category,
    spentOn: expense.spentOn, currency: expense.currency, amount: expense.amount, quantity: expense.quantity, notes: expense.notes,
    billable: expense.billable, reimbursable: expense.reimbursable, reimbursementStatus: expense.reimbursementStatus, status: expense.status,
    locked: lineId !== null ? 'invoiced' : expense.status === 'approved' ? 'approved' : isClosed(expense.spentOn) ? 'period' : null,
  }))
}

export async function readExpenseOptions(db: Db, actor: Actor): Promise<ExpenseOptions> {
  const rows = await db
    .select({ id: projects.id, name: projects.name, code: projects.code, client: clients.name, currency: clients.currency, type: projects.type })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projectMembers.personId, ownId(actor)), isCurrentMembership(), isNull(projects.archivedAt), isNull(clients.archivedAt)))
    .orderBy(asc(clients.name), asc(projects.name))
  const categories = await db.select().from(expenseCategories).where(isNull(expenseCategories.archivedAt)).orderBy(asc(expenseCategories.name))
  return {
    projects: rows.map(({ type, ...project }) => ({ ...project, billable: type !== 'non_billable' })),
    categories: categories.map(({ id, name, unitName, unitPrice }) => ({ id, name, unitName, unitPrice })),
  }
}

/** What is stored for the input, for someone who may enter it. */
async function checkInput(tx: Tx, personId: number, input: ExpenseInput) {
  const [found] = await tx
    .select({ project: projects, client: clients })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(projects.id, input.projectId))
  const member = await currentMembership(tx, personId, input.projectId)
  if (!found || !member || found.project.archivedAt || found.client.archivedAt) throw invalidInput({ projectId: 'Choose a project that you are on.' })
  const [category] = await tx.select().from(expenseCategories).where(and(eq(expenseCategories.id, input.categoryId), isNull(expenseCategories.archivedAt)))
  if (!category) throw invalidInput({ categoryId: 'Choose a category.' })
  const { quantity, amount, reimbursable, billable, ...rest } = input
  if (category.unitPrice !== null && (quantity === null || quantity <= 0)) throw invalidInput({ amount: `Enter how many (${category.unitName}).` })
  if (category.unitPrice === null && amount <= 0) throw invalidInput({ amount: 'Enter an amount.' })
  const units = category.unitPrice !== null && quantity !== null ? { quantity, unitPrice: category.unitPrice } : null
  return {
    ...rest,
    currency: found.client.currency,
    amount: units ? expenseAmount(units.quantity, units.unitPrice) : amount,
    quantity: units?.quantity ?? null,
    unitPrice: units?.unitPrice ?? null,
    billable: billable && found.project.type !== 'non_billable',
    reimbursable,
    reimbursementStatus: reimbursable ? ('pending' as const) : ('none' as const),
  }
}

async function checkOpen(ctx: AppContext, tx: Tx, personId: number, date: string) {
  const isClosed = await closedOn(tx, personId, date, date, await todayOf(tx, personId, ctx.now()))
  if (isClosed(date)) throw new ApiError(409, 'period_closed', 'This week was handed in or is closed. It cannot be changed.')
}

export async function createExpense(ctx: AppContext, actor: Actor, input: ExpenseInput): Promise<void> {
  const personId = ownId(actor)
  await runTransaction(ctx.db, async (tx) => {
    await checkOpen(ctx, tx, personId, input.spentOn)
    await tx.insert(expenses).values({ ...(await checkInput(tx, personId, input)), personId, createdBy: personId })
  })
}

export async function updateExpense(ctx: AppContext, actor: Actor, id: number, { version, ...input }: ExpenseInput & { version: number }): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const expense = await lockExpenseForEdit(tx, actor, id, version, { projectId: input.projectId })
    await checkOpen(ctx, tx, expense.personId, expense.spentOn)
    await checkOpen(ctx, tx, expense.personId, input.spentOn)
    await tx.update(expenses).set(await checkInput(tx, expense.personId, input)).where(eq(expenses.id, id))
  })
}

export async function deleteExpense(ctx: AppContext, actor: Actor, id: number, version: number): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const expense = await lockExpenseForEdit(tx, actor, id, version)
    await checkOpen(ctx, tx, expense.personId, expense.spentOn)
    await tx.delete(expenses).where(eq(expenses.id, id))
  })
}
