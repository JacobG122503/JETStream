import { and, eq, lt, ne, or } from 'drizzle-orm'
import type { Request, Response } from 'express'
import type { AppContext } from '../context'
import type { Db, Tx } from '../db'
import { people, roles, sessions } from '../db/schema'
import { clientAddress } from './clientAddress'
import { csrfTokenFor, hashToken, isToken, newToken } from './tokens'

const hour = 3_600_000
const day = 24 * hour

/** How long a session lasts without use, and in total. */
const lifetimes = {
  browser: { idleMs: 12 * hour, totalMs: 24 * hour },
  persistent: { idleMs: 30 * day, totalMs: 90 * day },
} as const
const lifetimeOf = (persistent: boolean) => (persistent ? lifetimes.persistent : lifetimes.browser)

const lastUseEveryMs = 60_000
export const sessionCookie = 'jetstream_session'

export interface CurrentSession {
  id: number
  token: string
  csrfToken: string
  persistent: boolean
  createdAt: Date
  expiresAt: Date
  person: Pick<
    typeof people.$inferSelect,
    'id' | 'name' | 'email' | 'status' | 'timeZone' | 'photoFileId' | 'version'
  >
  role: Pick<typeof roles.$inferSelect, 'id' | 'key' | 'name'>
}

/** The one place that knows who an administrator is; 005 replaces it with permissions. */
export const isAdministrator = ({ role }: Pick<CurrentSession, 'role'>) => role.key === 'administrator'

function readCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, value] = part.trim().split(/=(.*)/s)
    if (name === sessionCookie && isToken(value)) return value
  }
  return undefined
}

/** The live session of a request, with the person's status and role as they are now. */
export async function loadSession(ctx: AppContext, req: Request): Promise<CurrentSession | undefined> {
  const token = readCookie(req)
  if (token === undefined) return undefined
  const [row] = await ctx.db
    .select({
      session: sessions,
      person: {
        id: people.id, name: people.name, email: people.email, status: people.status, timeZone: people.timeZone,
        photoFileId: people.photoFileId, version: people.version,
      },
      role: { id: roles.id, key: roles.key, name: roles.name },
    })
    .from(sessions)
    .innerJoin(people, eq(people.id, sessions.personId))
    .innerJoin(roles, eq(roles.id, people.roleId))
    .where(eq(sessions.tokenHash, hashToken(token)))
  if (!row) return undefined
  const { session, person, role } = row
  const now = ctx.now()
  if (person.status === 'archived') {
    await endSessions(ctx.db, person.id)
    return undefined
  }
  if (isOver(session, now)) {
    await ctx.db.delete(sessions).where(eq(sessions.id, session.id))
    return undefined
  }
  const lastUseBefore = new Date(now.getTime() - lastUseEveryMs)
  if (session.lastUsedAt <= lastUseBefore) {
    await ctx.db
      .update(sessions)
      .set({ lastUsedAt: now })
      .where(and(eq(sessions.id, session.id), eq(sessions.lastUsedAt, session.lastUsedAt)))
  }
  const { id, persistent, createdAt, expiresAt } = session
  return { id, token, csrfToken: csrfTokenFor(token), persistent, createdAt, expiresAt, person, role }
}

type SessionTimes = Pick<typeof sessions.$inferSelect, 'persistent' | 'lastUsedAt' | 'expiresAt'>

export function isOver({ persistent, lastUsedAt, expiresAt }: SessionTimes, now: Date): boolean {
  return now >= expiresAt || now.getTime() - lastUsedAt.getTime() >= lifetimeOf(persistent).idleMs
}

export interface NewSession {
  token: string
  persistent: boolean
  expiresAt: Date
}

/**
 * Adds a session. The caller has locked the person and checked, after that, that they may sign in,
 * so that nothing that ends sessions can have happened in between. Sets no cookie: that is for when
 * the transaction is committed.
 */
export async function createSession(
  tx: Tx, ctx: AppContext, req: Request, personId: number, persistent: boolean,
): Promise<NewSession> {
  const token = newToken()
  const now = ctx.now()
  const expiresAt = new Date(now.getTime() + lifetimeOf(persistent).totalMs)
  await tx.insert(sessions).values({
    tokenHash: hashToken(token),
    personId,
    persistent,
    userAgent: req.get('User-Agent')?.slice(0, 300) ?? null,
    address: clientAddress(req),
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
  })
  return { token, persistent, expiresAt }
}

/** Gives a session a new token; the old one stops working. Undefined if the session has ended or got another token. */
export async function renewSession(tx: Tx, session: CurrentSession): Promise<NewSession | undefined> {
  const token = newToken()
  const renewed = await tx
    .update(sessions)
    .set({ tokenHash: hashToken(token) })
    .where(and(eq(sessions.id, session.id), eq(sessions.tokenHash, hashToken(session.token))))
    .returning({ id: sessions.id })
  if (renewed.length === 0) return undefined
  return { token, persistent: session.persistent, expiresAt: session.expiresAt }
}

export async function endSession(db: Db | Tx, id: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id))
}

/** Ends all sessions of a person, or all but one. */
export async function endSessions(db: Db | Tx, personId: number, exceptId?: number): Promise<void> {
  const own = eq(sessions.personId, personId)
  await db.delete(sessions).where(exceptId === undefined ? own : and(own, ne(sessions.id, exceptId)))
}

export async function removeOldSessions(db: Db, now: Date): Promise<void> {
  const idle = (persistent: boolean) =>
    and(eq(sessions.persistent, persistent), lt(sessions.lastUsedAt, new Date(now.getTime() - lifetimeOf(persistent).idleMs)))
  await db.delete(sessions).where(or(lt(sessions.expiresAt, now), idle(true), idle(false)))
}

const cookieOptions = (ctx: AppContext) =>
  ({ httpOnly: true, sameSite: 'lax', path: ctx.basePath, secure: ctx.publicUrl.startsWith('https:') }) as const

export function setSessionCookie(ctx: AppContext, res: Response, { token, persistent, expiresAt }: NewSession): void {
  const maxAge = persistent ? Math.max(0, expiresAt.getTime() - ctx.now().getTime()) : undefined
  res.cookie(sessionCookie, token, { ...cookieOptions(ctx), ...(maxAge === undefined ? {} : { maxAge }) })
}

export function clearSessionCookie(ctx: AppContext, res: Response): void {
  res.clearCookie(sessionCookie, cookieOptions(ctx))
}
