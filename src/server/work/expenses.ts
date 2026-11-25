/** Expenses: one's own, those of others, receipts and paying back. */
import { and, asc, between, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { expenseAmount } from '../../shared/calc'
import type { ExpenseCategory, ExpenseInput, ExpenseOptions, ExpenseRow, Receipt, TeamExpense } from '../../shared/work'
import type { Actor } from '../access/actor'
import { holds, ownId, requirePermission, requireRecord } from '../access/decisions'
import { readReceiptFacts } from '../access/facts'
import { filterFor } from '../access/filters'
import { invalidInput } from '../api/input'
import { lockExpenseForEdit } from '../billing'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx, updateVersioned } from '../db'
import { clients, expenseCategories, expenseReceipts, expenses, files, invoiceExpenses, people, projectMembers, projects } from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { cleanImage, ImageError } from '../people/image'
import { getSettings } from '../people/lookup'
import { currentMembership, isCurrentMembership } from '../people/membership'
import { holdClient, holdPerson, holdProject, logChange } from './common'
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
  const receipts = await receiptsOf(db, rows.map(({ expense }) => expense.id))
  return rows.map(({ expense, project, client, category, lineId }) => ({
    receipts: receipts(expense.id),
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
    notesRequired: (await getSettings(db)).expenseNotesRequired,
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
  if ((await getSettings(tx)).expenseNotesRequired && input.notes === '') throw invalidInput({ notes: 'Enter notes.' })
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
  if (isClosed(date)) throw new ApiError(409, 'period_closed', 'This week was submitted or is locked. It cannot be changed.')
}

export async function createExpense(ctx: AppContext, actor: Actor, input: ExpenseInput): Promise<number> {
  const personId = ownId(actor)
  return runTransaction(ctx.db, async (tx) => {
    const project = await holdProject(tx, input.projectId, 'use')
    await holdClient(tx, project.clientId, 'use')
    await holdPerson(tx, personId, 'use')
    await checkOpen(ctx, tx, personId, input.spentOn)
    const [expense] = await tx.insert(expenses).values({ ...(await checkInput(tx, personId, input)), personId, createdBy: personId }).returning({ id: expenses.id })
    return expense?.id ?? 0
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
    const attached = await tx.select({ id: expenseReceipts.fileId }).from(expenseReceipts).where(eq(expenseReceipts.expenseId, id))
    await tx.delete(expenses).where(eq(expenses.id, id))
    if (attached.length > 0) await tx.delete(files).where(inArray(files.id, attached.map((row) => row.id)))
  })
}

// Receipts -------------------------------------------------------------------------------------------

async function receiptsOf(db: Db, ids: number[]): Promise<(expenseId: number) => Receipt[]> {
  const rows = ids.length === 0 ? [] : await db
    .select({ expenseId: expenseReceipts.expenseId, id: files.id, name: files.name, mediaType: files.mediaType })
    .from(expenseReceipts)
    .innerJoin(files, eq(files.id, expenseReceipts.fileId))
    .where(inArray(expenseReceipts.expenseId, ids))
  return (expenseId) => rows.filter((row) => row.expenseId === expenseId).map(({ id, name, mediaType }) => ({ id, name, mediaType }))
}

export const receiptBytes = 5 * 1024 * 1024
const mostReceipts = 5

/** A picture, cleaned, or a PDF as it is. */
function readReceipt(upload: Buffer): { mediaType: string; content: Buffer; extension: string } {
  if (upload.subarray(0, 5).toString('latin1') === '%PDF-') return { mediaType: 'application/pdf', content: upload, extension: 'pdf' }
  try {
    const { mediaType, content } = cleanImage(upload)
    return { mediaType, content, extension: mediaType === 'image/png' ? 'png' : 'jpg' }
  } catch (error) {
    if (error instanceof ImageError) throw new ApiError(400, 'bad_file', 'Choose a PNG or JPEG picture, or a PDF.')
    throw error
  }
}

export async function addReceipt(ctx: AppContext, actor: Actor, id: number, version: number, upload: Buffer): Promise<void> {
  const { mediaType, content, extension } = readReceipt(upload)
  await runTransaction(ctx.db, async (tx) => {
    const expense = await lockExpenseForEdit(tx, actor, id, version)
    await checkOpen(ctx, tx, expense.personId, expense.spentOn)
    if ((await tx.$count(expenseReceipts, eq(expenseReceipts.expenseId, id))) >= mostReceipts) throw new ApiError(409, 'too_many', `An expense can have ${mostReceipts} receipts.`)
    const [file] = await tx
      .insert(files)
      .values({ name: `receipt-${expense.spentOn}.${extension}`, mediaType, content, sizeBytes: content.length, ownerId: expense.personId })
      .returning({ id: files.id })
    if (file) await tx.insert(expenseReceipts).values({ expenseId: id, fileId: file.id })
  })
}

export async function removeReceipt(ctx: AppContext, actor: Actor, id: number, version: number, fileId: number): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const expense = await lockExpenseForEdit(tx, actor, id, version)
    await checkOpen(ctx, tx, expense.personId, expense.spentOn)
    const [gone] = await tx.delete(expenseReceipts).where(and(eq(expenseReceipts.expenseId, id), eq(expenseReceipts.fileId, fileId))).returning()
    if (!gone) throw new NotFoundError(fileId)
    await tx.delete(files).where(eq(files.id, fileId))
  })
}

/** For whoever sees the expense. */
export async function readReceiptFile(db: Db, actor: Actor, expenseId: number, fileId: number): Promise<{ name: string; mediaType: string; content: Buffer }> {
  requireRecord(actor, { view: 'time.view', orOwner: true }, await readReceiptFacts(db, { expenseId, fileId }), fileId)
  const [file] = await db.select().from(files).where(eq(files.id, fileId))
  if (!file) throw new NotFoundError(fileId)
  return file
}

// Everyone's -------------------------------------------------------------------------------------------

export interface ExpenseFilter {
  from: string
  to: string
}

export async function listTeamExpenses(db: Db, actor: Actor, { from, to }: ExpenseFilter): Promise<{ expenses: TeamExpense[]; canReimburse: boolean }> {
  requirePermission(actor, 'time.view')
  const rows = await db
    .select({ expense: expenses, project: projects.name, client: clients.name, category: expenseCategories.name, person: people.name })
    .from(expenses)
    .innerJoin(projects, eq(projects.id, expenses.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .innerJoin(people, eq(people.id, expenses.personId))
    .where(and(filterFor(db, actor, 'time.view', 'expense'), between(expenses.spentOn, from, to)))
    .orderBy(desc(expenses.spentOn), desc(expenses.id))
  const receipts = await receiptsOf(db, rows.map(({ expense }) => expense.id))
  return {
    canReimburse: holds(actor, 'expenses.reimburse', 'all'),
    expenses: rows.map(({ expense, project, client, category, person }) => ({
      id: expense.id, version: expense.version, person: { id: expense.personId, name: person }, projectId: expense.projectId, project, client, categoryId: expense.categoryId,
      category, spentOn: expense.spentOn, currency: expense.currency, amount: expense.amount, quantity: expense.quantity, notes: expense.notes, billable: expense.billable,
      reimbursable: expense.reimbursable, reimbursementStatus: expense.reimbursementStatus, status: expense.status, receipts: receipts(expense.id),
    })),
  }
}

/** Records that approved expenses were paid back, or that they were not after all. */
export async function setReimbursed(ctx: AppContext, actor: Actor, ids: number[], paidOn: string | null): Promise<number> {
  requirePermission(actor, 'expenses.reimburse', 'all')
  if (ids.length === 0) throw invalidInput({ ids: 'Choose expenses.' })
  return runTransaction(ctx.db, async (tx) => {
    const rows = await tx.select().from(expenses).where(inArray(expenses.id, ids)).orderBy(asc(expenses.id)).for('update')
    const right = rows.filter(({ reimbursable, reimbursementStatus }) => reimbursable && reimbursementStatus === (paidOn === null ? 'paid' : 'approved'))
    if (right.length < ids.length) throw new ApiError(409, 'already_handled', 'Some of these are not approved yet, or were paid back already. Reload to see.')
    await tx
      .update(expenses)
      .set(paidOn === null ? { reimbursementStatus: 'approved', reimbursedOn: null } : { reimbursementStatus: 'paid', reimbursedOn: paidOn })
      .where(inArray(expenses.id, ids))
    await logChange(tx, actor, { action: 'updated', type: 'expense', id: null, summary: paidOn === null ? `Took back the reimbursement of ${ids.length} expenses` : `Reimbursed ${ids.length} expenses`, changes: { ids } })
    return right.length
  })
}

// Categories -------------------------------------------------------------------------------------------

export async function listCategories(db: Db, actor: Actor): Promise<ExpenseCategory[]> {
  requirePermission(actor, 'tasks.manage', 'all')
  const rows = await db.select().from(expenseCategories).orderBy(asc(sql`lower(${expenseCategories.name})`))
  return rows.map(({ id, version, name, unitName, unitPrice, archivedAt }) => ({ id, version, name, unitName, unitPrice, archived: archivedAt !== null }))
}

export interface CategoryInput {
  name: string
  unitName: string | null
  unitPrice: number | null
}

export async function saveCategory(ctx: AppContext, actor: Actor, id: number | null, { version, ...input }: CategoryInput & { version: number | null }): Promise<void> {
  requirePermission(actor, 'tasks.manage', 'all')
  if ((input.unitName === null) !== (input.unitPrice === null)) throw invalidInput({ unitPrice: 'Enter both the unit and its price, or neither.' })
  await runTransaction(ctx.db, async (tx) => {
    const same = await tx.select({ id: expenseCategories.id }).from(expenseCategories).where(and(eq(sql`lower(${expenseCategories.name})`, input.name.toLowerCase()), ne(expenseCategories.id, id ?? 0)))
    if (same.length > 0) throw invalidInput({ name: 'There is already a category with this name.' })
    if (id === null) await tx.insert(expenseCategories).values(input)
    else await updateVersioned(tx, expenseCategories, id, version ?? 0, input)
    await logChange(tx, actor, { action: id === null ? 'created' : 'updated', type: 'expense', id, summary: `Saved expense category ${input.name}` })
  })
}

export async function archiveCategory(ctx: AppContext, actor: Actor, id: number, archive: boolean): Promise<void> {
  requirePermission(actor, 'tasks.manage', 'all')
  const [row] = await ctx.db.update(expenseCategories).set({ archivedAt: archive ? ctx.now() : null }).where(eq(expenseCategories.id, id)).returning({ id: expenseCategories.id })
  if (!row) throw new NotFoundError(id)
}
