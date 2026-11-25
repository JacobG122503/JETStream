import { type Actor, actorId } from '../access/actor'
import type { Db, Tx } from '../db'
import { activityLog } from '../db/schema'

export interface Activity {
  /** Null for the system itself, such as a command on the server. */
  actorId: number | null
  action: string
  /** The person it was done to. Kept when that person is gone. */
  personId: number | null
  summary: string
  /** Before and after of what changed. Never holds a password or a token. */
  changes?: Record<string, unknown>
}

/** Notes what happened to a person or their access, in the transaction that does it. */
export async function logActivity(db: Db | Tx, { actorId: by, action, personId, summary, changes = {} }: Activity): Promise<void> {
  await db.insert(activityLog).values({ actorId: by, action, subjectType: 'person', subjectId: personId, summary, changes })
}

/** Notes what happened to a role. */
export async function logRoleActivity(
  tx: Tx, actor: Actor, { action, roleId, summary, changes }: { action: string; roleId: number; summary: string; changes: Record<string, unknown> },
): Promise<void> {
  await tx.insert(activityLog).values({ actorId: actorId(actor), action, subjectType: 'role', subjectId: roleId, summary, changes })
}
