/** Every email, sent or only kept. */
import { and, desc, ilike, or } from 'drizzle-orm'
import type { OutboxRow } from '../../shared/notifications'
import type { Actor } from '../access/actor'
import { requirePermission } from '../access/decisions'
import type { Db } from '../db'
import { outboxMessages } from '../db/schema'

const most = 200

export async function listOutbox(db: Db, actor: Actor, search: string): Promise<{ messages: OutboxRow[] }> {
  requirePermission(actor, 'outbox.view', 'all')
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
  const rows = await db
    .select()
    .from(outboxMessages)
    .where(and(search === '' ? undefined : or(ilike(outboxMessages.subject, pattern), ilike(outboxMessages.body, pattern))))
    .orderBy(desc(outboxMessages.createdAt), desc(outboxMessages.id))
    .limit(most)
  return {
    messages: rows.map(({ id, kind, status, recipients, subject, body, error, createdAt }) => ({ id, kind, status, recipients, subject, body, error, at: createdAt.toISOString() })),
  }
}

