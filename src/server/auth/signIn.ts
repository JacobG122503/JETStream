/**
 * Signing in, in steps: first who it is (a proof), then the session. 026 adds a second step in
 * between, and may keep the proof for as long as that takes: it is checked again in the end.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Request, Response } from 'express'
import type { DemoAccount, SessionInfo, SessionPerson } from '../../shared/api'
import type { Weekday } from '../../shared/dates'
import type { AppContext } from '../context'
import { accessFingerprint } from '../access/actor'
import { people, personCredentials } from '../db/schema'
import { demoAccounts } from '../demo/accounts'
import { type Tx, runTransaction } from '../db'
import { demoSeedDate } from '../demo/marker'
import { ApiError } from '../errors'
import { findPersonByEmail, getSettings, isSignUpOpen, lockPerson, passwordVersion } from '../people/lookup'
import { hashPassword, needsRehash, spendVerification, verifyPassword } from '../security/passwords'
import { inTurn, takeAttempt } from './limits'
import {
  createSession, type CurrentSession, endSession, loadSession, type NewSession, sessionCookie, setSessionCookie,
} from './sessions'

/** What someone showed. It holds only as long as the person has this password. */
export interface SignInProof {
  personId: number
  /** Null for a demo account, which needs no password. */
  passwordVersion: number | null
}

const invalidCredentials = () => new ApiError(401, 'invalid_credentials', 'The email or password is not right.')
const demoUnavailable = () => new ApiError(403, 'demo_unavailable', 'This demo account cannot be used.')

/** Checks email and password. Every refusal is the same and takes as long. */
export async function checkSignIn(ctx: AppContext, input: { email: string; password: string; address: string }): Promise<SignInProof> {
  const { email, password, address } = input
  return inTurn(`sign_in|${email}|${address}`, async () => {
    const attempt = await takeAttempt(ctx, 'sign_in', { email, address })
    const found = await findPersonByEmail(ctx.db, email)
    const usable = found !== undefined && found.person.status !== 'archived' && found.passwordHash !== null
    const right = usable ? await verifyPassword(password, found.passwordHash ?? '') : await spendVerification(password)
    if (!right || !found?.passwordHash || found.passwordVersion === null) throw invalidCredentials()
    await attempt.succeeded()
    if (needsRehash(found.passwordHash)) {
      const passwordHash = await hashPassword(password)
      await ctx.db
        .update(personCredentials)
        // The same password, so not a new version.
        .set({ passwordHash, version: sql`${personCredentials.version}` })
        // Not over a password that was changed meanwhile.
        .where(and(eq(personCredentials.personId, found.person.id), eq(personCredentials.passwordHash, found.passwordHash)))
    }
    return { personId: found.person.id, passwordVersion: found.passwordVersion }
  })
}

/**
 * Starts the session of someone who proved who they are. One the browser had before ends. Refused
 * when the proof no longer holds: the password was changed or the person archived meanwhile.
 */
export async function beginSession(
  ctx: AppContext, req: Request, res: Response, proof: SignInProof, persistent: boolean, before?: CurrentSession,
): Promise<void> {
  const session = await runTransaction(ctx.db, async (tx) => {
    await lockProof(tx, proof)
    if (before) await endSession(tx, before.id)
    return createSession(tx, ctx, req, proof.personId, persistent)
  })
  openSession(ctx, req, res, session)
}

/** Whatever ends all sessions of a person locks the person first, so it comes either before this or after. */
async function lockProof(tx: Tx, proof: SignInProof): Promise<void> {
  const person = await lockPerson(tx, proof.personId)
  if (proof.passwordVersion === null) {
    if (person?.status !== 'active') throw demoUnavailable()
    return
  }
  if (!person || person.status === 'archived' || (await passwordVersion(tx, person.id)) !== proof.passwordVersion) {
    throw invalidCredentials()
  }
}

/** Sets the cookie, and lets the rest of this request be answered for the new session. */
export function openSession(ctx: AppContext, req: Request, res: Response, session: NewSession): void {
  setSessionCookie(ctx, res, session)
  req.headers.cookie = `${sessionCookie}=${session.token}`
}

function sessionPerson(session: CurrentSession, companyTimeZone: string): SessionPerson {
  const { person, role, actor } = session
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    status: person.status,
    role: { key: role.key, name: role.name },
    administrator: actor.administrator,
    permissions: actor.grants,
    access: accessFingerprint(actor),
    timeZone: person.timeZone ?? companyTimeZone,
    photoId: person.photoFileId,
  }
}

/** What the web app needs to know first, signed in or not. */
export async function readSessionInfo(ctx: AppContext, req: Request): Promise<SessionInfo> {
  const session = await loadSession(ctx, req)
  const { name, timeZone, weekStartsOn } = await getSettings(ctx.db)
  return {
    company: { name, timeZone, weekStartsOn: weekStartsOn as Weekday },
    person: session ? sessionPerson(session, timeZone) : null,
    csrfToken: session?.csrfToken ?? null,
    signUpOpen: session ? false : await isSignUpOpen(ctx.db),
    emailDelivers: ctx.email.delivers,
    demoAccounts: session ? [] : await availableDemoAccounts(ctx),
  }
}

/** The demo accounts that can be used: only in demo mode, on demo data, and active ones. */
async function availableDemoAccounts(ctx: AppContext): Promise<(DemoAccount & { id: number })[]> {
  if (!ctx.demo || (await demoSeedDate(ctx.db)) === null) return []
  const rows = await ctx.db
    .select({ id: people.id, name: people.name, email: people.email })
    .from(people)
    .where(and(eq(people.status, 'active'), inArray(people.email, demoAccounts.map(({ email }) => email))))
  return demoAccounts.flatMap(({ key, email, label }) => {
    const row = rows.find((candidate) => candidate.email === email)
    return row ? [{ key, label, name: row.name, id: row.id }] : []
  })
}

export async function findDemoAccount(ctx: AppContext, key: string): Promise<SignInProof> {
  const account = (await availableDemoAccounts(ctx)).find((candidate) => candidate.key === key)
  if (!account) throw demoUnavailable()
  return { personId: account.id, passwordVersion: null }
}
