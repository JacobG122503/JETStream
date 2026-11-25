import type { Db, Tx } from '../db'
import { activityLog } from '../db/schema'

export interface Activity {
  /** Null for the system itself, such as a command on the server. */
  actorId: number | null
  action: string
  /** The person it was done to. Kept when that person is gone. */
  personId: number | null
  summary: string
  /** Never holds a password or a token. */
  changes?: Record<string, unknown>
}

/** Notes what happened to a person or their access, in the transaction that does it. */
export async function logActivity(db: Db | Tx, { actorId, action, personId, summary, changes = {} }: Activity): Promise<void> {
  await db.insert(activityLog).values({ actorId, action, subjectType: 'person', subjectId: personId, summary, changes })
}
