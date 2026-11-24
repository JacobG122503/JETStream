import { sql } from 'drizzle-orm'
import { index, integer, pgTable, text } from 'drizzle-orm/pg-core'
import { assignmentRepeats } from '../../../shared/domain'
import {
  createdAt, dateOrder, day, id, indexes, instant, minutes, oneOf, rule, uniqueIgnoringCase, updatedAt, version,
} from './columns'
import { people } from './people'
import { projects, tasks } from './projects'

/** Someone yet to be hired or chosen. */
export const placeholders = pgTable(
  'placeholders',
  {
    id: id(),
    name: text('name').notNull(),
    weeklyCapacityMinutes: minutes('weekly_capacity_minutes').notNull().default(2400),
    archivedAt: instant('archived_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIgnoringCase(t.name),
    rule(t.weeklyCapacityMinutes, 'weekly_capacity_range', sql`${t.weeklyCapacityMinutes} between 0 and 10080`),
  ],
)

/** Planned time on a project, of a person or a placeholder. */
export const assignments = pgTable(
  'assignments',
  {
    id: id(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    taskId: integer('task_id').references(() => tasks.id),
    personId: integer('person_id').references(() => people.id),
    placeholderId: integer('placeholder_id').references(() => placeholders.id),
    startsOn: day('starts_on').notNull(),
    endsOn: day('ends_on').notNull(),
    minutesPerDay: minutes('minutes_per_day').notNull(),
    repeat: text('repeat', { enum: assignmentRepeats }).notNull().default('none'),
    repeatUntil: day('repeat_until'),
    notes: text('notes').notNull().default(''),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    rule(t.personId, 'person_or_placeholder', sql`(${t.personId} is null) <> (${t.placeholderId} is null)`),
    dateOrder(t.startsOn, t.endsOn),
    dateOrder(t.endsOn, t.repeatUntil),
    rule(t.minutesPerDay, 'minutes_per_day_range', sql`${t.minutesPerDay} between 1 and 1440`),
    oneOf(t.repeat, assignmentRepeats),
    rule(t.repeat, 'repeat_has_end', sql`(${t.repeat} = 'none') = (${t.repeatUntil} is null)`),
    index('assignments_person_idx').on(t.personId, t.startsOn),
    index('assignments_project_idx').on(t.projectId, t.startsOn),
    ...indexes(t.taskId, t.placeholderId),
  ],
)

export const milestones = pgTable(
  'milestones',
  {
    id: id(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    dueOn: day('due_on').notNull(),
    completedOn: day('completed_on'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => indexes(t.projectId, t.dueOn),
)
