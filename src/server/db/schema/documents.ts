/** What invoices, recurring invoices and estimates have in common. */
import { sql } from 'drizzle-orm'
import { type AnyPgColumn, boolean, integer, pgTable, text } from 'drizzle-orm/pg-core'
import { clients } from './clients'
import {
  createdAt, currencyCode, id, instant, money, percent, percentRange, quantity, rule, uniqueIgnoringCase, updatedAt,
  version,
} from './columns'
import { projects } from './projects'

/** Categories of invoice and estimate lines. */
export const itemCategories = pgTable(
  'item_categories',
  {
    id: id(),
    name: text('name').notNull(),
    archivedAt: instant('archived_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIgnoringCase(t.name)],
)

export const documentColumns = () => ({
  clientId: integer('client_id')
    .notNull()
    .references(() => clients.id),
  subject: text('subject').notNull().default(''),
  purchaseOrder: text('purchase_order').notNull().default(''),
  notes: text('notes').notNull().default(''),
  currency: text('currency').notNull(),
  discountPercent: percent('discount_percent'),
  tax1Name: text('tax1_name'),
  tax1Percent: percent('tax1_percent'),
  tax2Name: text('tax2_name'),
  tax2Percent: percent('tax2_percent'),
})

/** Kept for lists and reports; always what documentTotals returns for the lines. */
export const totalColumns = () => ({
  subtotal: money('subtotal').notNull().default(0),
  discountAmount: money('discount_amount').notNull().default(0),
  tax1Amount: money('tax1_amount').notNull().default(0),
  tax2Amount: money('tax2_amount').notNull().default(0),
  total: money('total').notNull().default(0),
})

export const lineColumns = () => ({
  id: id(),
  position: integer('position').notNull(),
  categoryId: integer('category_id').references(() => itemCategories.id),
  projectId: integer('project_id').references(() => projects.id),
  description: text('description').notNull().default(''),
  /** Only shown on lines of time, whose amount comes from their minutes. */
  quantity: quantity('quantity').notNull(),
  /** Minor units; the hourly rate on lines of time. */
  unitPrice: money('unit_price').notNull(),
  amount: money('amount').notNull(),
  tax1: boolean('tax1').notNull().default(false),
  tax2: boolean('tax2').notNull().default(false),
})

type Columns = Record<
  'currency' | 'discountPercent' | 'tax1Percent' | 'tax2Percent',
  AnyPgColumn
>
export const documentRules = (t: Columns) => [
  ...currencyCode(t.currency),
  ...percentRange(t.discountPercent, t.tax1Percent, t.tax2Percent),
]

type Totals = Record<'subtotal' | 'discountAmount' | 'tax1Amount' | 'tax2Amount' | 'total', AnyPgColumn>
export const totalRules = (t: Totals) =>
  rule(
    t.total,
    'total_adds_up',
    sql`${t.total} = ${t.subtotal} - ${t.discountAmount} + ${t.tax1Amount} + ${t.tax2Amount}`,
  )
