/** Telling people about what concerns them: in the app, and by email where they want it. */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { NotificationKind, NotificationList, NotificationPreference } from '../../shared/notifications'
import { notificationKinds } from '../../shared/notifications'
import type { Actor } from '../access/actor'
import { ownId } from '../access/decisions'
import type { AppContext } from '../context'
import { type Db, type Tx } from '../db'
import { notificationPreferences, notifications, people } from '../db/schema'
import { sendEmail } from '../email/sender'

export interface Notice {
  kind: NotificationKind
  title: string
  body: string
  /** In-app path to open. */
  path: string
}

export async function preferenceOf(db: Db | Tx, personId: number, kind: NotificationKind): Promise<{ inApp: boolean; email: boolean }> {
  const [row] = await db.select().from(notificationPreferences).where(and(eq(notificationPreferences.personId, personId), eq(notificationPreferences.kind, kind)))
  return row ?? { inApp: true, email: notificationKinds[kind].email }
}

/** Call it after the change was saved: a message that cannot be sent changes nothing else. */
export async function notify(ctx: Pick<AppContext, 'db' | 'email'>, personIds: readonly number[], notice: Notice): Promise<void> {
  const wanted = [...new Set(personIds)]
  if (wanted.length === 0) return
  const active = await ctx.db.select({ id: people.id, name: people.name, email: people.email }).from(people).where(and(inArray(people.id, wanted), eq(people.status, 'active')))
  for (const { id, name, email } of active) {
    const preference = await preferenceOf(ctx.db, id, notice.kind)
    if (preference.inApp) await ctx.db.insert(notifications).values({ personId: id, ...notice })
    if (preference.email) {
      await sendEmail(ctx.email, { kind: notice.kind, to: { name, email }, subject: notice.title, body: `Hello ${name},\n\n${notice.body}`, personId: id })
    }
  }
}

const most = 50

export async function listNotifications(db: Db, actor: Actor): Promise<NotificationList> {
  const personId = ownId(actor)
  const rows = await db.select().from(notifications).where(eq(notifications.personId, personId)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(most)
  return {
    unread: await db.$count(notifications, and(eq(notifications.personId, personId), isNull(notifications.readAt))),
    rows: rows.map(({ id, kind, title, body, path, readAt, createdAt }) => ({ id, kind, title, body, path, read: readAt !== null, at: createdAt.toISOString() })),
  }
}

/** Marks one, or all, as read. */
export async function markRead(ctx: AppContext, actor: Actor, id: number | null): Promise<void> {
  const own = and(eq(notifications.personId, ownId(actor)), isNull(notifications.readAt))
  await ctx.db.update(notifications).set({ readAt: ctx.now() }).where(id === null ? own : and(own, eq(notifications.id, id)))
}

export async function listPreferences(db: Db, actor: Actor): Promise<NotificationPreference[]> {
  const personId = ownId(actor)
  const result: NotificationPreference[] = []
  for (const kind of Object.keys(notificationKinds) as NotificationKind[]) result.push({ kind, ...(await preferenceOf(db, personId, kind)) })
  return result.map(({ kind, inApp, email }) => ({ kind, inApp, email }))
}

export async function savePreference(db: Db, actor: Actor, { kind, inApp, email }: NotificationPreference): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({ personId: ownId(actor), kind, inApp, email })
    .onConflictDoUpdate({ target: [notificationPreferences.personId, notificationPreferences.kind], set: { inApp, email, version: sql`${notificationPreferences.version} + 1`, updatedAt: sql`now()` } })
}
