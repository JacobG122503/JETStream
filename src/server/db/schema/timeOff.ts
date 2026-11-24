import { sql } from 'drizzle-orm'
import { boolean, index, integer, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core'
import { accrualMethods, timeOffEntryKinds, timeOffKinds, timeOffStatuses } from '../../../shared/domain'
import {
  createdAt, dateOrder, day, id, indexes, instant, minutes, notNegative, oneOf, rule, uniqueIgnoringCase, updatedAt,
  version,
} from './columns'
import { people } from './people'

export const timeOffPolicies = pgTable(
  'time_off_policies',
  {
    id: id(),
    name: text('name').notNull(),
    kind: text('kind', { enum: timeOffKinds }).notNull(),
    paid: boolean('paid').notNull(),
    accrualMethod: text('accrual_method', { enum: accrualMethods }).notNull(),
    /** Per year or month, as the method says. */
    accrualMinutes: minutes('accrual_minutes').notNull().default(0),
    /** Null for no limit. */
    maximumBalanceMinutes: minutes('maximum_balance_minutes'),
    carryOverMinutes: minutes('carry_over_minutes'),
    requiresApproval: boolean('requires_approval').notNull().default(true),
    archivedAt: instant('archived_at'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIgnoringCase(t.name),
    oneOf(t.kind, timeOffKinds),
    oneOf(t.accrualMethod, accrualMethods),
    ...notNegative(t.accrualMinutes, t.maximumBalanceMinutes, t.carryOverMinutes),
  ],
)

export const timeOffPolicyPeople = pgTable(
  'time_off_policy_people',
  {
    policyId: integer('policy_id')
      .notNull()
      .references(() => timeOffPolicies.id, { onDelete: 'cascade' }),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    startsOn: day('starts_on').notNull(),
  },
  (t) => [primaryKey({ columns: [t.policyId, t.personId] }), ...indexes(t.personId)],
)

export const timeOffRequests = pgTable(
  'time_off_requests',
  {
    id: id(),
    policyId: integer('policy_id')
      .notNull()
      .references(() => timeOffPolicies.id),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id),
    startsOn: day('starts_on').notNull(),
    endsOn: day('ends_on').notNull(),
    /** On each working day of the request. */
    minutesPerDay: minutes('minutes_per_day').notNull(),
    status: text('status', { enum: timeOffStatuses }).notNull().default('pending'),
    note: text('note').notNull().default(''),
    decidedBy: integer('decided_by').references(() => people.id),
    decidedAt: instant('decided_at'),
    decisionComment: text('decision_comment').notNull().default(''),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    dateOrder(t.startsOn, t.endsOn),
    rule(t.minutesPerDay, 'minutes_per_day_range', sql`${t.minutesPerDay} between 1 and 1440`),
    oneOf(t.status, timeOffStatuses),
    index('time_off_requests_person_idx').on(t.personId, t.startsOn),
    ...indexes(t.policyId, t.decidedBy),
  ],
)

/** The balance ledger: a balance is the sum of a person's rows of a policy. */
export const timeOffEntries = pgTable(
  'time_off_entries',
  {
    id: id(),
    policyId: integer('policy_id')
      .notNull()
      .references(() => timeOffPolicies.id),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id),
    kind: text('kind', { enum: timeOffEntryKinds }).notNull(),
    occurredOn: day('occurred_on').notNull(),
    /** Positive adds to the balance, negative takes from it. */
    minutes: minutes('minutes').notNull(),
    requestId: integer('request_id').references(() => timeOffRequests.id),
    notes: text('notes').notNull().default(''),
    recordedBy: integer('recorded_by').references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf(t.kind, timeOffEntryKinds),
    rule(t.kind, 'used_has_request', sql`(${t.kind} = 'used') = (${t.requestId} is not null)`),
    index('time_off_entries_person_idx').on(t.personId, t.policyId, t.occurredOn),
    ...indexes(t.policyId, t.requestId, t.recordedBy),
  ],
)

export const holidayCalendars = pgTable(
  'holiday_calendars',
  {
    id: id(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIgnoringCase(t.name)],
)

export const holidays = pgTable(
  'holidays',
  {
    id: id(),
    calendarId: integer('calendar_id')
      .notNull()
      .references(() => holidayCalendars.id, { onDelete: 'cascade' }),
    observedOn: day('observed_on').notNull(),
    name: text('name').notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('holidays_calendar_day_key').on(t.calendarId, t.observedOn)],
)

/** Working time on each weekday. */
export const workSchedules = pgTable(
  'work_schedules',
  {
    id: id(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    mondayMinutes: minutes('monday_minutes').notNull().default(480),
    tuesdayMinutes: minutes('tuesday_minutes').notNull().default(480),
    wednesdayMinutes: minutes('wednesday_minutes').notNull().default(480),
    thursdayMinutes: minutes('thursday_minutes').notNull().default(480),
    fridayMinutes: minutes('friday_minutes').notNull().default(480),
    saturdayMinutes: minutes('saturday_minutes').notNull().default(0),
    sundayMinutes: minutes('sunday_minutes').notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIgnoringCase(t.name),
    ...[
      t.mondayMinutes, t.tuesdayMinutes, t.wednesdayMinutes, t.thursdayMinutes, t.fridayMinutes, t.saturdayMinutes,
      t.sundayMinutes,
    ].map((column) => rule(column, `${column.name}_range`, sql`${column} between 0 and 1440`)),
  ],
)

/** A person's work schedule and holiday calendar from a date on; without a row the defaults apply. */
export const personSchedules = pgTable(
  'person_schedules',
  {
    id: id(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    startsOn: day('starts_on').notNull(),
    workScheduleId: integer('work_schedule_id').references(() => workSchedules.id),
    holidayCalendarId: integer('holiday_calendar_id').references(() => holidayCalendars.id),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('person_schedules_person_start_key').on(t.personId, t.startsOn),
    ...indexes(t.workScheduleId, t.holidayCalendarId),
  ],
)
