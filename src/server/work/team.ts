/** Who worked how much in a week. */
import { and, asc, between, eq, inArray } from 'drizzle-orm'
import { addDays, type IsoDate, startOfWeek, type Weekday } from '../../shared/dates'
import type { TeamWeek } from '../../shared/work'
import type { Actor } from '../access/actor'
import { ownId, requirePermission } from '../access/decisions'
import { filterFor } from '../access/filters'
import type { AppContext } from '../context'
import { sumExact } from '../db'
import { people, roles, timeEntries } from '../db/schema'
import { getSettings } from '../people/lookup'
import { todayOf } from './time'

/** The people the actor may see, with the hours the actor may see of them. */
export async function readTeamWeek(ctx: AppContext, actor: Actor, date: IsoDate | null): Promise<TeamWeek> {
  requirePermission(actor, 'people.view')
  const { db } = ctx
  const today = await todayOf(db, ownId(actor), ctx.now())
  const { weekStartsOn } = await getSettings(db)
  const from = startOfWeek(date ?? today, weekStartsOn as Weekday)
  const to = addDays(from, 6)
  const rows = await db
    .select({ id: people.id, name: people.name, photoId: people.photoFileId, role: roles.name, kind: people.kind, capacityMinutes: people.weeklyCapacityMinutes })
    .from(people)
    .innerJoin(roles, eq(roles.id, people.roleId))
    .where(and(eq(people.status, 'active'), filterFor(db, actor, 'people.view', 'person')))
    .orderBy(asc(people.name))
  const worked = rows.length === 0 ? [] : await db
    .select({ id: timeEntries.personId, billable: timeEntries.billable, minutes: sumExact(timeEntries.minutes) })
    .from(timeEntries)
    .where(
      and(
        inArray(timeEntries.personId, rows.map(({ id }) => id)), between(timeEntries.spentOn, from, to),
        filterFor(db, actor, 'time.view', 'timeEntry', { orOwner: true }),
      ),
    )
    .groupBy(timeEntries.personId, timeEntries.billable)
  const minutesOf = (id: number, billable: boolean) => worked.find((row) => row.id === id && row.billable === billable)?.minutes ?? 0
  return {
    from, to, today,
    members: rows.map((row) => ({ ...row, minutes: minutesOf(row.id, true) + minutesOf(row.id, false), billableMinutes: minutesOf(row.id, true) })),
  }
}
