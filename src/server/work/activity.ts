/** The activity log. */
import { and, desc, eq, gte, ilike, lt, or } from 'drizzle-orm'
import { addDays, type IsoDate } from '../../shared/dates'
import type { ActivityRow } from '../../shared/work'
import type { Actor } from '../access/actor'
import { requirePermission } from '../access/decisions'
import { instantAt } from '../clock'
import type { Db } from '../db'
import { activityLog, people } from '../db/schema'
import { getSettings } from '../people/lookup'

export interface ActivityFilter {
  from: IsoDate | null
  to: IsoDate | null
  type: string | null
  personId: number | null
  search: string
}

const most = 500

export async function listActivity(db: Db, actor: Actor, { from, to, type, personId, search }: ActivityFilter): Promise<{ rows: ActivityRow[]; more: boolean }> {
  requirePermission(actor, 'activity.view', 'all')
  const { timeZone } = await getSettings(db)
  const literal = search.replace(/[\\%_]/g, '\\$&')
  const rows = await db
    .select({ row: activityLog, name: people.name })
    .from(activityLog)
    .leftJoin(people, eq(people.id, activityLog.actorId))
    .where(
      and(
        from ? gte(activityLog.createdAt, instantAt(from, 0, timeZone)) : undefined,
        to ? lt(activityLog.createdAt, instantAt(addDays(to, 1), 0, timeZone)) : undefined,
        type ? eq(activityLog.subjectType, type) : undefined,
        personId ? eq(activityLog.actorId, personId) : undefined,
        search ? or(ilike(activityLog.summary, `%${literal}%`), ilike(people.name, `%${literal}%`)) : undefined,
      ),
    )
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(most + 1)
  return {
    rows: rows.slice(0, most).map(({ row, name }) => ({
      id: row.id, at: row.createdAt.toISOString(), actor: name, action: row.action, type: row.subjectType, summary: row.summary,
    })),
    more: rows.length > most,
  }
}
