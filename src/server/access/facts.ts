/** Reads what decisions.ts has to know about a record. */
import { and, eq, isNotNull } from 'drizzle-orm'
import type { Db, Tx } from '../db'
import {
  assignments, clients, estimateLines, estimates, expenseReceipts, expenses, invoiceLines, invoices, people, projects, timeEntries,
  timeOffRequests,
} from '../db/schema'
import type { RecordFacts, RecordType } from './decisions'

/** Receipts are asked for by the expense and the file. */
export interface ReceiptId {
  expenseId: number
  fileId: number
}

const first = <T>(rows: T[]): T | undefined => rows[0]

/** Undefined for a record that does not exist. */
export async function readFacts(db: Db | Tx, type: Exclude<RecordType, 'receipt'>, id: number): Promise<RecordFacts | undefined> {
  switch (type) {
    case 'project': {
      const row = first(await db.select({ projectId: projects.id }).from(projects).where(eq(projects.id, id)))
      return row && { type, ...row }
    }
    case 'client': {
      const row = first(await db.select({ clientId: clients.id }).from(clients).where(eq(clients.id, id)))
      return row && { type, ...row }
    }
    case 'person': {
      const row = first(await db.select({ personId: people.id }).from(people).where(eq(people.id, id)))
      return row && { type, ...row }
    }
    case 'timeEntry': {
      const fields = { personId: timeEntries.personId, projectId: timeEntries.projectId }
      const row = first(await db.select(fields).from(timeEntries).where(eq(timeEntries.id, id)))
      return row && { type, ...row }
    }
    case 'expense': {
      const fields = { personId: expenses.personId, projectId: expenses.projectId }
      const row = first(await db.select(fields).from(expenses).where(eq(expenses.id, id)))
      return row && { type, ...row }
    }
    case 'invoice': {
      const row = first(await db.select({ createdBy: invoices.createdBy }).from(invoices).where(eq(invoices.id, id)))
      const lines = await db
        .selectDistinct({ projectId: invoiceLines.projectId })
        .from(invoiceLines)
        .where(and(eq(invoiceLines.invoiceId, id), isNotNull(invoiceLines.projectId)))
      return row && { type, ...row, projectIds: known(lines) }
    }
    case 'estimate': {
      const fields = { createdBy: estimates.createdBy, projectId: estimates.projectId }
      const row = first(await db.select(fields).from(estimates).where(eq(estimates.id, id)))
      const lines = await db
        .selectDistinct({ projectId: estimateLines.projectId })
        .from(estimateLines)
        .where(and(eq(estimateLines.estimateId, id), isNotNull(estimateLines.projectId)))
      return row && { type, createdBy: row.createdBy, projectIds: known([row, ...lines]) }
    }
    case 'assignment': {
      const fields = { personId: assignments.personId, projectId: assignments.projectId }
      const row = first(await db.select(fields).from(assignments).where(eq(assignments.id, id)))
      return row && { type, ...row }
    }
    case 'timeOffRequest': {
      const row = first(await db.select({ personId: timeOffRequests.personId }).from(timeOffRequests).where(eq(timeOffRequests.id, id)))
      return row && { type, ...row }
    }
  }
}

export async function readReceiptFacts(db: Db | Tx, { expenseId, fileId }: ReceiptId): Promise<RecordFacts | undefined> {
  const row = first(
    await db
      .select({ personId: expenses.personId, projectId: expenses.projectId })
      .from(expenseReceipts)
      .innerJoin(expenses, eq(expenses.id, expenseReceipts.expenseId))
      .where(and(eq(expenseReceipts.expenseId, expenseId), eq(expenseReceipts.fileId, fileId))),
  )
  return row && { type: 'receipt', ...row }
}

const known = (rows: { projectId: number | null }[]): number[] => [
  ...new Set(rows.flatMap(({ projectId }) => (projectId === null ? [] : [projectId]))),
]
