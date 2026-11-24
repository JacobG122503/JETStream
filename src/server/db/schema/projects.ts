import { boolean, index, integer, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core'
import { budgetTypes, projectTypes, rateMethods } from '../../../shared/domain'
import { clients } from './clients'
import {
  createdAt, dateOrder, day, id, indexes, instant, minutes, money, notNegative, oneOf, percent, percentRange,
  uniqueIgnoringCase, updatedAt, version,
} from './columns'
import { people } from './people'

/** The company's task library. */
export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    name: text('name').notNull(),
    billableByDefault: boolean('billable_by_default').notNull().default(true),
    /** Per hour, in company currency. */
    defaultRate: money('default_rate'),
    /** Added to new projects. */
    common: boolean('common').notNull().default(false),
    archivedAt: instant('archived_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIgnoringCase(t.name), ...notNegative(t.defaultRate)],
)

/** Amounts are in the currency of the project's client. */
export const projects = pgTable(
  'projects',
  {
    id: id(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    code: text('code').notNull().default(''),
    startsOn: day('starts_on'),
    endsOn: day('ends_on'),
    notes: text('notes').notNull().default(''),
    type: text('type', { enum: projectTypes }).notNull(),
    rateMethod: text('rate_method', { enum: rateMethods }).notNull(),
    /** Per hour, for rate method project. */
    rate: money('rate'),
    /** For type fixed_fee. */
    fixedFee: money('fixed_fee'),
    budgetType: text('budget_type', { enum: budgetTypes }).notNull().default('none'),
    /** For budget type total_hours; per-task and per-person budgets are on those tables. */
    budgetMinutes: minutes('budget_minutes'),
    /** For budget type total_fees. */
    budgetAmount: money('budget_amount'),
    budgetMonthly: boolean('budget_monthly').notNull().default(false),
    budgetIncludesExpenses: boolean('budget_includes_expenses').notNull().default(false),
    budgetVisibleToAll: boolean('budget_visible_to_all').notNull().default(false),
    /** Null for no alerts. */
    budgetAlertPercent: percent('budget_alert_percent'),
    archivedAt: instant('archived_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    oneOf(t.type, projectTypes),
    oneOf(t.rateMethod, rateMethods),
    oneOf(t.budgetType, budgetTypes),
    dateOrder(t.startsOn, t.endsOn),
    ...notNegative(t.rate, t.fixedFee, t.budgetMinutes, t.budgetAmount),
    ...percentRange(t.budgetAlertPercent),
    ...indexes(t.clientId),
  ],
)

/** Tasks used on a project. Kept, but not active, once removed, so that old time keeps its rate. */
export const projectTasks = pgTable(
  'project_tasks',
  {
    id: id(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: integer('task_id')
      .notNull()
      .references(() => tasks.id),
    billable: boolean('billable').notNull().default(true),
    rate: money('rate'),
    budgetMinutes: minutes('budget_minutes'),
    budgetAmount: money('budget_amount'),
    removedAt: instant('removed_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('project_tasks_project_task_key').on(t.projectId, t.taskId),
    ...notNegative(t.rate, t.budgetMinutes, t.budgetAmount),
    ...indexes(t.taskId),
  ],
)

/** People on a project. Kept once removed, like project tasks. */
export const projectMembers = pgTable(
  'project_members',
  {
    id: id(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id),
    isManager: boolean('is_manager').notNull().default(false),
    rate: money('rate'),
    budgetMinutes: minutes('budget_minutes'),
    removedAt: instant('removed_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('project_members_project_person_key').on(t.projectId, t.personId),
    ...notNegative(t.rate, t.budgetMinutes),
    ...indexes(t.personId),
  ],
)

export const tags = pgTable(
  'tags',
  { id: id(), name: text('name').notNull(), version: version(), createdAt: createdAt(), updatedAt: updatedAt() },
  (t) => [uniqueIgnoringCase(t.name)],
)

export const projectTags = pgTable(
  'project_tags',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.tagId] }), ...indexes(t.tagId)],
)

/** Projects a person keeps at the top of their list. */
export const projectPins = pgTable(
  'project_pins',
  {
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.projectId] }), ...indexes(t.projectId)],
)

/** Budget alerts already sent, so that each is sent once. */
export const budgetAlerts = pgTable(
  'budget_alerts',
  {
    id: id(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** First day of the month of a monthly budget; the earliest date otherwise. */
    periodStart: day('period_start').notNull().default('0001-01-01'),
    percent: percent('percent').notNull(),
    sentAt: instant('sent_at').notNull().defaultNow(),
  },
  (t) => [
    unique('budget_alerts_project_period_percent_key').on(t.projectId, t.periodStart, t.percent),
    ...notNegative(t.percent),
    index('budget_alerts_sent_at_idx').on(t.sentAt),
  ],
)
