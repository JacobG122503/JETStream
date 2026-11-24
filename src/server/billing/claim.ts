/**
 * Billing time and expenses: the only way entries get onto an invoice.
 *
 * Rows are locked in one order everywhere, so that two bills cannot wait for each other forever:
 * number sequence, retainer, invoice, time entries by id, expenses by id.
 */
import { and, asc, eq, inArray, max } from 'drizzle-orm'
import {
  type BillableRate, type DatedRate, hoursQuantity, resolveBillableRate, roundMinutes, sumIntegers, thousand, timeAmount,
  type TimeRounding,
} from '../../shared/calc'
import { type Db, NotFoundError, runTransaction, StaleError, type Tx } from '../db'
import {
  clients, companySettings, expenseCategories, expenses, invoiceExpenses, invoiceLines, invoices, invoiceTimeEntries,
  people, personRates, projectMembers, projects, projectTasks, tasks, timeEntries,
} from '../db/schema'
import { BillingError, ClaimError, type ClaimProblem, type ClaimProblemReason } from './errors'
import { type Invoice, lockInvoiceForLines, recalculateInvoice } from './invoiceTotals'
import { allocateNumber } from './numbers'

/** A record and the version of it the caller decided to bill. */
export interface SeenRecord {
  id: number
  version: number
}

export type TimeGrouping = 'task' | 'person' | 'project' | 'detailed'
export type ExpenseGrouping = 'category' | 'person' | 'project' | 'detailed'

interface LineSettings {
  categoryId?: number | null
  tax1?: boolean
  tax2?: boolean
}

export interface Claim {
  timeEntries: readonly SeenRecord[]
  expenses: readonly SeenRecord[]
  timeGrouping?: TimeGrouping
  expenseGrouping?: ExpenseGrouping
  timeLines?: LineSettings
  expenseLines?: LineSettings
}

/** Totals, status and number are not the caller's to choose. */
export type NewInvoice = Pick<
  typeof invoices.$inferInsert,
  | 'clientId' | 'subject' | 'purchaseOrder' | 'notes' | 'currency' | 'discountPercent' | 'tax1Name' | 'tax1Percent'
  | 'tax2Name' | 'tax2Percent' | 'issuedOn' | 'dueOn' | 'paymentTerms' | 'createdBy'
>

/** Makes a draft invoice of the entries. If any of them cannot be billed, nothing happens. */
export function createInvoiceFromEntries(db: Db, invoice: NewInvoice, claim: Claim): Promise<Invoice> {
  return runTransaction(db, async (tx) => {
    const number = await allocateNumber(tx, 'invoice')
    const [created] = await tx.insert(invoices).values({ ...invoice, number }).returning()
    if (!created) throw new Error('The invoice was not stored.')
    return claimEntries(tx, created, claim)
  })
}

/** Adds the entries to a draft or open invoice. If any of them cannot be billed, nothing happens. */
export function addEntriesToInvoice(db: Db, invoice: SeenRecord, claim: Claim): Promise<Invoice> {
  return runTransaction(db, async (tx) => {
    const locked = await lockInvoiceForLines(tx, invoice.id)
    if (locked.version !== invoice.version) throw new StaleError(invoice.id, invoice.version)
    return claimEntries(tx, locked, claim)
  })
}

/** The invoice is locked, or was made in this transaction. */
async function claimEntries(tx: Tx, invoice: Invoice, claim: Claim): Promise<Invoice> {
  if (claim.timeEntries.length + claim.expenses.length === 0) {
    throw new BillingError('nothing_to_bill', 'No time or expenses were chosen.')
  }
  const problems: ClaimProblem[] = []
  const time = await lockTime(tx, invoice, claim.timeEntries, problems)
  const costs = await lockExpenses(tx, invoice, claim.expenses, problems)
  const billed = await resolveRates(tx, invoice, time, problems)
  if (problems.length > 0) throw new ClaimError(problems)

  const lines = [
    ...timeLines(billed, claim.timeGrouping ?? 'task', claim.timeLines ?? {}),
    ...expenseLines(costs, claim.expenseGrouping ?? 'category', claim.expenseLines ?? {}),
  ]
  await insertLines(tx, invoice, lines)
  return recalculateInvoice(tx, invoice)
}

// Reading and checking -------------------------------------------------------------------------

type Expense = typeof expenses.$inferSelect
type Project = typeof projects.$inferSelect

interface TimeRow {
  entry: typeof timeEntries.$inferSelect
  project: Project
  projectTask: typeof projectTasks.$inferSelect
  task: typeof tasks.$inferSelect
  personName: string
}

async function lockTime(tx: Tx, invoice: Invoice, wanted: readonly SeenRecord[], problems: ClaimProblem[]) {
  if (wanted.length === 0) return []
  const ids = wanted.map(({ id }) => id)
  await tx
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(inArray(timeEntries.id, ids))
    .orderBy(asc(timeEntries.id))
    .for('update')
  // Read after locking, in statements of their own, so that they see what was saved while waiting.
  const rows: TimeRow[] = await tx
    .select({ entry: timeEntries, project: projects, projectTask: projectTasks, task: tasks, personName: people.name })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .innerJoin(
      projectTasks,
      and(eq(projectTasks.projectId, timeEntries.projectId), eq(projectTasks.taskId, timeEntries.taskId)),
    )
    .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .innerJoin(people, eq(people.id, timeEntries.personId))
    .where(inArray(timeEntries.id, ids))
    .orderBy(asc(timeEntries.spentOn), asc(timeEntries.id))
  const links = await tx
    .select({ id: invoiceTimeEntries.timeEntryId })
    .from(invoiceTimeEntries)
    .where(inArray(invoiceTimeEntries.timeEntryId, ids))

  const usable = checkEach('time', wanted, rows, ({ entry }) => entry, links, problems, ({ entry, project }) => {
    if (entry.timerStartedAt !== null) return 'running'
    return project.clientId === invoice.clientId ? null : 'other_client'
  })
  return rows.filter(({ entry }) => usable.has(entry.id))
}

interface ExpenseRow {
  expense: Expense
  project: Project
  categoryName: string
  personName: string
}

async function lockExpenses(tx: Tx, invoice: Invoice, wanted: readonly SeenRecord[], problems: ClaimProblem[]) {
  if (wanted.length === 0) return []
  const ids = wanted.map(({ id }) => id)
  await tx
    .select({ id: expenses.id })
    .from(expenses)
    .where(inArray(expenses.id, ids))
    .orderBy(asc(expenses.id))
    .for('update')
  const rows: ExpenseRow[] = await tx
    .select({ expense: expenses, project: projects, categoryName: expenseCategories.name, personName: people.name })
    .from(expenses)
    .innerJoin(projects, eq(projects.id, expenses.projectId))
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .innerJoin(people, eq(people.id, expenses.personId))
    .where(inArray(expenses.id, ids))
    .orderBy(asc(expenses.spentOn), asc(expenses.id))
  const links = await tx
    .select({ id: invoiceExpenses.expenseId })
    .from(invoiceExpenses)
    .where(inArray(invoiceExpenses.expenseId, ids))

  const usable = checkEach('expense', wanted, rows, ({ expense }) => expense, links, problems, ({ expense, project }) => {
    if (project.clientId !== invoice.clientId) return 'other_client'
    if (expense.currency !== invoice.currency) return 'other_currency'
    return project.type === 'non_billable' ? 'not_billable' : null
  })
  return rows.filter(({ expense }) => usable.has(expense.id))
}

interface Claimable {
  id: number
  version: number
  billable: boolean
  billedOutside: boolean
}

/** Adds a problem for each record that cannot be billed, and returns the ids of the others. */
function checkEach<Row>(
  kind: ClaimProblem['kind'],
  wanted: readonly SeenRecord[],
  rows: readonly Row[],
  recordOf: (row: Row) => Claimable,
  links: readonly { id: number }[],
  problems: ClaimProblem[],
  checkMore: (row: Row) => ClaimProblemReason | null,
): Set<number> {
  const byId = new Map(rows.map((row) => [recordOf(row).id, row]))
  const invoiced = new Set(links.map(({ id }) => id))
  const usable = new Set<number>()
  const check = ({ id, version }: SeenRecord): ClaimProblemReason | null => {
    const row = byId.get(id)
    if (row === undefined) return 'not_found'
    if (usable.has(id)) return 'duplicate'
    const record = recordOf(row)
    if (invoiced.has(id)) return 'already_invoiced'
    if (record.version !== version) return 'stale'
    if (record.billedOutside) return 'billed_outside'
    if (!record.billable) return 'not_billable'
    return checkMore(row)
  }
  for (const record of wanted) {
    const reason = check(record)
    if (reason === null) usable.add(record.id)
    else problems.push({ kind, id: record.id, reason })
  }
  return usable
}

// Rates ------------------------------------------------------------------------------------------

interface BilledTime extends TimeRow {
  /** After time rounding. */
  minutes: number
  rate: number
}

async function resolveRates(
  tx: Tx,
  invoice: Invoice,
  rows: readonly TimeRow[],
  problems: ClaimProblem[],
): Promise<BilledTime[]> {
  if (rows.length === 0) return []
  const [settings] = await tx.select().from(companySettings)
  const [client] = await tx.select().from(clients).where(eq(clients.id, invoice.clientId))
  if (!settings) throw new Error('The company settings are missing.')
  if (!client) throw new NotFoundError(invoice.clientId)
  const rounding: TimeRounding = { mode: settings.roundingMode, increment: settings.roundingMinutes }

  const personIds = [...new Set(rows.map(({ entry }) => entry.personId))]
  const projectIds = [...new Set(rows.map(({ project }) => project.id))]
  const members = await tx
    .select()
    .from(projectMembers)
    .where(and(inArray(projectMembers.projectId, projectIds), inArray(projectMembers.personId, personIds)))
  const memberRates = new Map(members.map((member) => [`${member.projectId}/${member.personId}`, member.rate]))
  const dated = new Map<number, DatedRate[]>(personIds.map((id) => [id, []]))
  const stored = await tx
    .select()
    .from(personRates)
    .where(and(eq(personRates.kind, 'billable'), inArray(personRates.personId, personIds)))
  for (const { personId, startsOn, rate } of stored) dated.get(personId)?.push({ startsOn, rate })

  const billed: BilledTime[] = []
  for (const row of rows) {
    const { entry, project, projectTask, task } = row
    if (client.currency !== invoice.currency) {
      problems.push({ kind: 'time', id: entry.id, reason: 'other_currency' })
      continue
    }
    const resolved = resolveBillableRate({
      date: entry.spentOn,
      billable: entry.billable,
      project: { type: project.type, rateMethod: project.rateMethod, rate: project.rate, currency: client.currency },
      task: { projectRate: projectTask.rate, defaultRate: task.defaultRate },
      person: {
        projectRate: memberRates.get(`${project.id}/${entry.personId}`) ?? null,
        rates: dated.get(entry.personId) ?? [],
      },
      companyCurrency: settings.currency,
    })
    const rate = chargedRate(resolved)
    if (typeof rate === 'number') billed.push({ ...row, rate, minutes: roundMinutes(entry.minutes, rounding) })
    else problems.push({ kind: 'time', id: entry.id, reason: rate })
  }
  return billed
}

/** Hours covered by a fixed fee, or deliberately without a rate, are billed at 0. */
function chargedRate(resolved: BillableRate): number | ClaimProblemReason {
  switch (resolved.kind) {
    case 'rate':
      return resolved.rate
    case 'fixed_fee':
    case 'no_hourly_rate':
      return 0
    case 'not_billable':
      return 'not_billable'
    case 'missing':
      return 'missing_rate'
  }
}

// Lines ------------------------------------------------------------------------------------------

interface DraftLine {
  line: Omit<typeof invoiceLines.$inferInsert, 'id' | 'invoiceId' | 'position'>
  time: Omit<typeof invoiceTimeEntries.$inferInsert, 'lineId'>[]
  expenses: Omit<typeof invoiceExpenses.$inferInsert, 'lineId'>[]
}

/** In order of first appearance. Map keeps that order. */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): [T, ...T[]][] {
  const groups = new Map<string, [T, ...T[]]>()
  for (const item of items) {
    const group = groups.get(keyOf(item))
    if (group) group.push(item)
    else groups.set(keyOf(item), [item])
  }
  return [...groups.values()]
}

const projectName = ({ code, name }: Project) => (code ? `[${code}] ${name}` : name)

function timeLines(rows: readonly BilledTime[], grouping: TimeGrouping, settings: LineSettings): DraftLine[] {
  const keyOf = ({ entry, project, rate }: BilledTime) => {
    // Different rates never share a line.
    const common = `${project.id}/${rate}`
    switch (grouping) {
      case 'task':
        return `${common}/${entry.taskId}`
      case 'person':
        return `${common}/${entry.personId}`
      case 'project':
        return common
      case 'detailed':
        return String(entry.id)
    }
  }
  const describe = ({ entry, project, task, personName }: BilledTime) => {
    const parts = {
      task: [task.name],
      person: [personName],
      project: [],
      detailed: [task.name, entry.spentOn, personName, entry.notes],
    }[grouping]
    return [projectName(project), ...parts].filter(Boolean).join(', ')
  }
  return groupBy(rows, keyOf).map((group) => {
    const [first] = group
    const minutes = sumIntegers(group.map((row) => row.minutes))
    return {
      line: {
        kind: 'time',
        projectId: first.project.id,
        categoryId: settings.categoryId ?? null,
        description: describe(first),
        minutes,
        quantity: hoursQuantity(minutes),
        unitPrice: first.rate,
        amount: timeAmount(minutes, first.rate),
        tax1: settings.tax1 ?? false,
        tax2: settings.tax2 ?? false,
      },
      time: group.map((row) => ({
        timeEntryId: row.entry.id,
        minutes: row.minutes,
        rate: row.rate,
        amount: timeAmount(row.minutes, row.rate),
      })),
      expenses: [],
    }
  })
}

function expenseLines(rows: readonly ExpenseRow[], grouping: ExpenseGrouping, settings: LineSettings): DraftLine[] {
  const keyOf = ({ expense, project }: ExpenseRow) =>
    ({
      category: `${project.id}/${expense.categoryId}`,
      person: `${project.id}/${expense.personId}`,
      project: String(project.id),
      detailed: `expense ${expense.id}`,
    })[grouping]
  const describe = ({ expense, project, categoryName, personName }: ExpenseRow) => {
    const parts = {
      category: [categoryName],
      person: [personName, 'expenses'],
      project: ['expenses'],
      detailed: [categoryName, expense.spentOn, personName, expense.notes],
    }[grouping]
    return [projectName(project), ...parts].filter(Boolean).join(', ')
  }
  return groupBy(rows, keyOf).map((group) => {
    const [first] = group
    const amount = sumIntegers(group.map(({ expense }) => expense.amount))
    return {
      line: {
        kind: 'expense',
        projectId: first.project.id,
        categoryId: settings.categoryId ?? null,
        description: describe(first),
        quantity: thousand,
        unitPrice: amount,
        amount,
        tax1: settings.tax1 ?? false,
        tax2: settings.tax2 ?? false,
      },
      time: [],
      expenses: group.map(({ expense }) => ({ expenseId: expense.id, amount: expense.amount })),
    }
  })
}

async function insertLines(tx: Tx, invoice: Invoice, drafts: readonly DraftLine[]) {
  const [last] = await tx
    .select({ position: max(invoiceLines.position) })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoice.id))
  const firstPosition = (last?.position ?? 0) + 1
  for (const [index, { line, time, expenses: costs }] of drafts.entries()) {
    const [inserted] = await tx
      .insert(invoiceLines)
      .values({ ...line, invoiceId: invoice.id, position: firstPosition + index })
      .returning({ id: invoiceLines.id })
    if (!inserted) throw new Error('The invoice line was not stored.')
    if (time.length > 0) {
      await tx.insert(invoiceTimeEntries).values(time.map((link) => ({ ...link, lineId: inserted.id })))
    }
    if (costs.length > 0) {
      await tx.insert(invoiceExpenses).values(costs.map((link) => ({ ...link, lineId: inserted.id })))
    }
  }
}
