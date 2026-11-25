/** Passwords: changing one's own, reset links, and asking for help. */
import { and, asc, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { HelpRequest, NewLink } from '../../shared/api'
import { type Actor, actorId, loadActor, readPersonAccess } from '../access/actor'
import { requirePermission } from '../access/decisions'
import { lockForAccessChange, requireOutranks } from '../access/grants'
import { mayReset } from '../access/links'
import { attemptsFor, inTurn, takeAttempt } from '../auth/limits'
import { type CurrentSession, endSessions, type NewSession, renewSession } from '../auth/sessions'
import { hashToken, isToken, newToken } from '../auth/tokens'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { type Db, runTransaction, StaleError, type Tx } from '../db'
import { helpRequests, passwordResets, people, personCredentials } from '../db/schema'
import { passwordChangedText, resetText } from '../email/messages'
import { sendEmail } from '../email/sender'
import { ApiError } from '../errors'
import { hashPassword, spendVerification, verifyPassword } from '../security/passwords'
import { logActivity } from './activity'
import { closeHelpRequests } from './invites'
import { linkInvalid, linkTo } from './links'
import { findPersonByEmail, hasPassword, lockPerson, passwordVersion } from './lookup'
import { checkNewPassword } from './newPassword'

const resetMs = 3_600_000
const resetsPerEmail = 3

async function tellPasswordChanged(ctx: AppContext, person: { id: number; name: string; email: string }) {
  await sendEmail(ctx.email, { ...passwordChangedText(person.name), to: { name: person.name, email: person.email }, personId: person.id })
}

/** Voids all reset links of a person that were not used. */
async function voidResets(tx: Tx, personId: number, now: Date) {
  await tx
    .update(passwordResets)
    .set({ revokedAt: now })
    .where(and(eq(passwordResets.personId, personId), isNull(passwordResets.usedAt), isNull(passwordResets.revokedAt)))
}

export async function storePassword(tx: Tx, personId: number, passwordHash: string, now: Date) {
  await tx
    .insert(personCredentials)
    .values({ personId, passwordHash, changedAt: now })
    .onConflictDoUpdate({ target: personCredentials.personId, set: { passwordHash, changedAt: now, version: sql`${personCredentials.version} + 1` },
    })
  await voidResets(tx, personId, now)
  await closeHelpRequests(tx, personId, now)
}

/** Changes one's own password. All other sessions end, and this one gets a new token. */
export async function changePassword(
  ctx: AppContext, session: CurrentSession, input: { currentPassword: string; newPassword: string },
): Promise<NewSession> {
  const { person } = session
  checkNewPassword(input.newPassword, person.email, 'newPassword')
  const checkedVersion = await inTurn(`password_check|${person.id}`, async () => {
    const attempt = await takeAttempt(ctx, 'password_check', { email: person.email.toLowerCase() })
    const [stored] = await ctx.db.select().from(personCredentials).where(eq(personCredentials.personId, person.id))
    const right = stored
      ? await verifyPassword(input.currentPassword, stored.passwordHash)
      : await spendVerification(input.currentPassword)
    if (!right || !stored) throw invalidInput({ currentPassword: 'This is not your current password.' })
    await attempt.succeeded()
    return stored.version
  })
  const passwordHash = await hashPassword(input.newPassword)
  const renewed = await runTransaction(ctx.db, async (tx) => {
    const current = await lockPerson(tx, person.id)
    // Ended while the password was being checked: whoever has it may do nothing any more.
    const result = current?.status === 'active' ? await renewSession(tx, session) : undefined
    if (!result) throw new ApiError(401, 'unauthenticated', 'Sign in first')
    // Set anew meanwhile: that one stays.
    if ((await passwordVersion(tx, person.id)) !== checkedVersion) throw new StaleError(person.id, person.version)
    await storePassword(tx, person.id, passwordHash, ctx.now())
    await endSessions(tx, person.id, session.id)
    await logActivity(tx, {
      actorId: person.id, action: 'password_changed', personId: person.id, summary: `${person.name} changed their password`,
    })
    return result
  })
  await tellPasswordChanged(ctx, person)
  return renewed
}

async function addReset(tx: Tx, personId: number, createdBy: number | null, now: Date) {
  const token = newToken()
  const expiresAt = new Date(now.getTime() + resetMs)
  await voidResets(tx, personId, now)
  await tx.insert(passwordResets).values({ tokenHash: hashToken(token), personId, createdBy, expiresAt, createdAt: now })
  await closeHelpRequests(tx, personId, now)
  return { token, expiresAt }
}

/** Someone who manages people makes a reset link to hand over. */
export async function createResetLink(ctx: AppContext, actor: Actor, personId: number): Promise<NewLink> {
  const now = ctx.now()
  const { person, token, expiresAt } = await runTransaction(ctx.db, async (tx) => {
    const maker = await lockForAccessChange(tx, actor, { people: [personId] })
    requirePermission(maker, 'people.manage', 'all')
    const found = await lockPerson(tx, personId)
    const target = await readPersonAccess(tx, personId)
    if (!found || !target) throw new ApiError(404, 'not_found', 'Not found')
    requireOutranks(maker, target)
    if (found.status !== 'active') throw new ApiError(409, 'not_active', 'Only active people can get a reset link.')
    if (!(await hasPassword(tx, personId))) {
      throw new ApiError(409, 'no_password', 'This person has no password yet. Send an invite instead.')
    }
    const reset = await addReset(tx, personId, actorId(maker), now)
    await logActivity(tx, {
      actorId: actorId(maker), action: 'reset_link_made', personId, summary: `Made a password reset link for ${found.name}`,
    })
    return { person: found, ...reset }
  })
  const link = linkTo(ctx, 'reset-password', token)
  await sendEmail(ctx.email, {
    ...resetText(person.name), to: { name: person.name, email: person.email }, link, personId, createdBy: actorId(actor) ?? undefined,
  })
  return { link, expiresAt: expiresAt.toISOString(), emailed: ctx.email.delivers }
}

/**
 * "Forgot password". The caller answers the same whatever happens here. Where email is delivered
 * the person gets a link; otherwise an administrator sees a help request.
 */
export async function askForHelp(ctx: AppContext, email: string, address: string): Promise<void> {
  await takeAttempt(ctx, 'forgot_password', { email, address })
  if ((await attemptsFor(ctx, 'forgot_password', email)) > resetsPerEmail) return
  const now = ctx.now()
  const message = await runTransaction(ctx.db, async (tx) => {
    const found = await findPersonByEmail(tx, email)
    if (found?.person.status !== 'active') return undefined
    const { person } = found
    if (ctx.email.delivers && found.passwordHash) {
      const { token } = await addReset(tx, person.id, null, now)
      return { ...resetText(person.name), to: { name: person.name, email: person.email }, link: linkTo(ctx, 'reset-password', token), personId: person.id }
    }
    await tx.insert(helpRequests).values({ personId: person.id, createdAt: now }).onConflictDoNothing()
    return undefined
  })
  // Not waited for: how long sending takes would tell that the account exists.
  if (message) void sendEmail(ctx.email, message)
}

export async function listHelpRequests(db: Db, actor: Actor): Promise<HelpRequest[]> {
  requirePermission(actor, 'people.manage', 'all')
  const rows = await db
    .select({ help: helpRequests, person: people, credential: personCredentials.personId })
    .from(helpRequests)
    .innerJoin(people, eq(people.id, helpRequests.personId))
    .leftJoin(personCredentials, eq(personCredentials.personId, people.id))
    .where(and(isNull(helpRequests.closedAt), eq(people.status, 'active')))
    .orderBy(asc(helpRequests.createdAt))
  return rows.map(({ help, person, credential }) => ({
    id: help.id,
    personId: person.id,
    name: person.name,
    email: person.email,
    requestedAt: help.createdAt.toISOString(),
    hasPassword: credential !== null,
  }))
}

/** The reset a working link belongs to; throws when the link does not work, whatever the reason. */
async function requireReset(db: Db | Tx, token: unknown, now: Date) {
  if (!isToken(token)) throw linkInvalid()
  const [row] = await db
    .select({ reset: passwordResets, person: people })
    .from(passwordResets)
    .innerJoin(people, eq(people.id, passwordResets.personId))
    .where(eq(passwordResets.tokenHash, hashToken(token)))
  if (!row || row.reset.usedAt || row.reset.revokedAt || row.reset.expiresAt <= now || row.person.status !== 'active') {
    throw linkInvalid()
  }
  // Made by the system when nobody is named; otherwise by someone who could still make it.
  if (row.reset.createdBy !== null) {
    const target = await readPersonAccess(db, row.person.id)
    if (!target || !mayReset(await loadActor(db, row.reset.createdBy), target)) throw linkInvalid()
  }
  return row
}

/** Whose password a link sets. Does not use the link up. */
export async function readReset(ctx: AppContext, token: unknown): Promise<{ email: string }> {
  return { email: (await requireReset(ctx.db, token, ctx.now())).person.email }
}

export async function usePasswordReset(ctx: AppContext, input: { token: unknown; password: string }): Promise<void> {
  const { person, reset: found } = await requireReset(ctx.db, input.token, ctx.now())
  checkNewPassword(input.password, person.email)
  const passwordHash = await hashPassword(input.password)
  await runTransaction(ctx.db, async (tx) => {
    const now = ctx.now()
    // The maker too, so that losing the access to make it comes wholly before or after.
    const maker = found.createdBy === null ? null : await loadActor(tx, found.createdBy)
    if (maker) await lockForAccessChange(tx, maker, { people: [person.id] })
    await lockPerson(tx, person.id)
    const { reset } = await requireReset(tx, input.token, now)
    await tx.update(passwordResets).set({ usedAt: now }).where(eq(passwordResets.id, reset.id))
    await storePassword(tx, person.id, passwordHash, now)
    await endSessions(tx, person.id)
    await logActivity(tx, {
      actorId: person.id, action: 'password_reset', personId: person.id, summary: `${person.name} set a new password with a reset link`,
    })
  })
  await tellPasswordChanged(ctx, person)
}

/** Links that can never be used again. */
export async function removeOldResets(db: Db, now: Date): Promise<void> {
  await db
    .delete(passwordResets)
    .where(or(lte(passwordResets.expiresAt, now), isNotNull(passwordResets.usedAt), isNotNull(passwordResets.revokedAt)))
}
