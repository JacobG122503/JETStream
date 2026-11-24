import { sql } from 'drizzle-orm'
import { boolean, foreignKey, index, integer, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import { entryStatuses } from '../../../shared/domain'
import { createdAt, day, id, indexes, instant, minutes, oneOf, rule, updatedAt, version } from './columns'
import { importBatches } from './imports'
import { people } from './people'
import { projects, projectTasks } from './projects'

/** No rate is stored: it is resolved from the project, task and person when needed. */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: id(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    taskId: integer('task_id').notNull(),
    spentOn: day('spent_on').notNull(),
    /** Without the time of a running timer. */
    minutes: minutes('minutes').notNull(),
    /** Minutes after midnight, in start/end entry mode. */
    startMinute: minutes('start_minute'),
    endMinute: minutes('end_minute'),
    /** Set while the timer runs. */
    timerStartedAt: instant('timer_started_at'),
    notes: text('notes').notNull().default(''),
    billable: boolean('billable').notNull(),
    status: text('status', { enum: entryStatuses }).notNull().default('unsubmitted'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => people.id),
    /** Invoiced before JET Time was used; imported history. */
    billedOutside: boolean('billed_outside').notNull().default(false),
    /** Identifies the source, such as a calendar event, so that it is imported once. */
    externalReference: text('external_reference'),
    importBatchId: integer('import_batch_id').references(() => importBatches.id),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Also what keeps a project's task from being deleted while it has time.
    foreignKey({
      name: 'time_entries_project_task_fk',
      columns: [t.projectId, t.taskId],
      foreignColumns: [projectTasks.projectId, projectTasks.taskId],
    }),
    rule(t.minutes, 'minutes_range', sql`${t.minutes} between 0 and 1440`),
    rule(
      t.startMinute,
      'start_end',
      sql`(${t.startMinute} is null) = (${t.endMinute} is null)
        and ${t.startMinute} between 0 and 1440 and ${t.endMinute} between ${t.startMinute} and 1440`,
    ),
    oneOf(t.status, entryStatuses),
    rule(
      t.timerStartedAt,
      'running_not_submitted',
      sql`${t.timerStartedAt} is null or ${t.status} in ('unsubmitted', 'rejected')`,
    ),
    uniqueIndex('time_entries_one_running_timer_key')
      .on(t.personId)
      .where(sql`${t.timerStartedAt} is not null`),
    unique('time_entries_external_reference_key').on(t.personId, t.externalReference),
    index('time_entries_person_date_idx').on(t.personId, t.spentOn),
    index('time_entries_project_task_date_idx').on(t.projectId, t.taskId, t.spentOn),
    index('time_entries_date_idx').on(t.spentOn),
    ...indexes(t.createdBy, t.importBatchId),
  ],
)

/** Rows a person adds to their timesheet often. */
export const timeFavorites = pgTable(
  'time_favorites',
  {
    id: id(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').notNull(),
    taskId: integer('task_id').notNull(),
    notes: text('notes').notNull().default(''),
    position: integer('position').notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'time_favorites_project_task_fk',
      columns: [t.projectId, t.taskId],
      foreignColumns: [projectTasks.projectId, projectTasks.taskId],
    }).onDelete('cascade'),
    unique('time_favorites_row_key').on(t.personId, t.projectId, t.taskId, t.notes),
    index('time_favorites_project_task_idx').on(t.projectId, t.taskId),
  ],
)
