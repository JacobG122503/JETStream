import { sql } from 'drizzle-orm'
import { boolean, index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { entryStatuses, reimbursementStatuses } from '../../../shared/domain'
import {
  createdAt, currencyCode, day, id, indexes, instant, money, notNegative, oneOf, quantity, rule, uniqueIgnoringCase,
  unitPrice, updatedAt, version,
} from './columns'
import { files, people } from './people'
import { projects } from './projects'

export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: id(),
    name: text('name').notNull(),
    /** Such as mile; set together with the price for categories entered as units. */
    unitName: text('unit_name'),
    unitPrice: unitPrice('unit_price'),
    archivedAt: instant('archived_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIgnoringCase(t.name),
    ...notNegative(t.unitPrice),
    rule(t.unitName, 'unit_and_price', sql`(${t.unitName} is null) = (${t.unitPrice} is null)`),
  ],
)

export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    categoryId: integer('category_id')
      .notNull()
      .references(() => expenseCategories.id),
    spentOn: day('spent_on').notNull(),
    currency: text('currency').notNull(),
    /** For units: quantity × unit price, rounded when entered. */
    amount: money('amount').notNull(),
    quantity: quantity('quantity'),
    /** The category's price at the time. */
    unitPrice: unitPrice('unit_price'),
    notes: text('notes').notNull().default(''),
    billable: boolean('billable').notNull(),
    reimbursable: boolean('reimbursable').notNull().default(false),
    reimbursementStatus: text('reimbursement_status', { enum: reimbursementStatuses }).notNull().default('none'),
    reimbursedOn: day('reimbursed_on'),
    status: text('status', { enum: entryStatuses }).notNull().default('unsubmitted'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => people.id),
    billedOutside: boolean('billed_outside').notNull().default(false),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...currencyCode(t.currency),
    ...notNegative(t.amount, t.quantity, t.unitPrice),
    rule(t.quantity, 'quantity_and_price', sql`(${t.quantity} is null) = (${t.unitPrice} is null)`),
    oneOf(t.reimbursementStatus, reimbursementStatuses),
    rule(t.reimbursable, 'reimbursement', sql`${t.reimbursable} = (${t.reimbursementStatus} <> 'none')`),
    oneOf(t.status, entryStatuses),
    index('expenses_person_date_idx').on(t.personId, t.spentOn),
    index('expenses_project_date_idx').on(t.projectId, t.spentOn),
    ...indexes(t.categoryId, t.createdBy),
  ],
)

export const expenseReceipts = pgTable(
  'expense_receipts',
  {
    expenseId: integer('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    fileId: integer('file_id')
      .notNull()
      .references(() => files.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.fileId] }), ...indexes(t.fileId)],
)
