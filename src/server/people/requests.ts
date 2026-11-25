/** Asking to join, and what administrators decide. */
import { asc, eq } from 'drizzle-orm'
import type { JoinRequest } from '../../shared/api'
import { takeAttempt } from '../auth/limits'
import type { AppContext } from '../context'
import { type Db, runTransaction } from '../db'
import { companySettings, people, personCredentials } from '../db/schema'
import { approvedText, declinedText, signUpNoticeText } from '../email/messages'
import { sendEmail } from '../email/sender'
import { ApiError } from '../errors'
import { hashPassword } from '../security/passwords'
import { logActivity } from './activity'
import { addAssignments, type Assignments, checkAssignments } from './assignments'
import { hasOpenInvite } from './invites'
import { builtInRole, findPersonByEmail, getSettings, isSignUpOpen, lockEmail, lockPerson, requireRole } from './lookup'
import { checkNewPassword } from './newPassword'

export interface SignUpInput {
  name: string
  email: string
  password: string
  timeZone: string
}

/** The caller answers the same whether or not the address was free. */
export async function signUp(ctx: AppContext, input: SignUpInput, address: string): Promise<void> {
  if (!(await isSignUpOpen(ctx.db))) throw new ApiError(403, 'sign_up_closed', 'Requests to join are turned off at the moment.')
  const { name, email, password, timeZone } = input
  checkNewPassword(password, email)
  await takeAttempt(ctx, 'sign_up', { email, address })
  // Also for an address that is taken, so that the time it takes says nothing.
  const passwordHash = await hashPassword(password)
  const now = ctx.now()
  const taken = await runTransaction(ctx.db, async (tx) => {
    await lockEmail(tx, email)
    const found = await findPersonByEmail(tx, email)
    if (found) return { name: found.person.name }
    // Not the typed name: the message must not carry a stranger's text.
    if (await hasOpenInvite(tx, email, now)) return { name: email }
    const role = await builtInRole(tx, 'member')
    const [person] = await tx
      .insert(people)
      .values({ name, email, timeZone, status: 'pending', roleId: role.id, createdAt: now })
      .returning({ id: people.id })
    await tx.insert(personCredentials).values({ personId: person?.id ?? 0, passwordHash, changedAt: now })
    return undefined
  })
  if (!taken) return
  const notice = sendEmail(ctx.email, { ...signUpNoticeText(taken.name), to: { name: taken.name, email } })
  // Not waited for where it takes long, which would tell that the address is taken.
  if (!ctx.email.delivers) await notice
}

export async function listRequests(db: Db): Promise<JoinRequest[]> {
  const rows = await db.select().from(people).where(eq(people.status, 'pending')).orderBy(asc(people.createdAt), asc(people.id))
  return rows.map(({ id, name, email, createdAt }) => ({ id, name, email, requestedAt: createdAt.toISOString() }))
}

const alreadyHandled = () => new ApiError(409, 'already_handled', 'This request was already handled. The list is up to date now.')

export async function approveRequest(
  ctx: AppContext, personId: number, input: Assignments & { roleId: number }, actorId: number,
): Promise<void> {
  const person = await runTransaction(ctx.db, async (tx) => {
    const found = await lockPerson(tx, personId)
    if (found?.status !== 'pending') throw alreadyHandled()
    const role = await requireRole(tx, input.roleId)
    const chosen = await checkAssignments(tx, input)
    await tx.update(people).set({ status: 'active', roleId: role.id }).where(eq(people.id, personId))
    await addAssignments(tx, personId, chosen)
    await logActivity(tx, {
      actorId, action: 'approved', personId, summary: `Approved ${found.name} (${found.email}) as ${role.name}`,
      changes: { role: role.name, ...chosen },
    })
    return found
  })
  const { name: company } = await getSettings(ctx.db)
  await sendEmail(ctx.email, {
    ...approvedText(person.name, company), to: { name: person.name, email: person.email }, personId, createdBy: actorId,
  })
}

/** Removes the pending person with everything of theirs, so that the address can be used again. */
export async function declineRequest(ctx: AppContext, personId: number, actorId: number): Promise<void> {
  const person = await runTransaction(ctx.db, async (tx) => {
    const found = await lockPerson(tx, personId)
    if (found?.status !== 'pending') throw alreadyHandled()
    await tx.delete(people).where(eq(people.id, personId))
    await logActivity(tx, {
      actorId, action: 'declined', personId, summary: `Declined the request of ${found.name} (${found.email})`,
    })
    return found
  })
  const { name: company } = await getSettings(ctx.db)
  await sendEmail(ctx.email, {
    ...declinedText(person.name, company), to: { name: person.name, email: person.email }, createdBy: actorId,
  })
}

export async function switchSignUp(ctx: AppContext, enabled: boolean, actorId: number): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const [settings] = await tx.select().from(companySettings).for('update')
    if (settings?.signUpEnabled === enabled) return
    await tx.update(companySettings).set({ signUpEnabled: enabled })
    await logActivity(tx, {
      actorId, action: 'sign_up_switched', personId: null, summary: `Turned requests to join ${enabled ? 'on' : 'off'}`,
      changes: { signUpEnabled: [!enabled, enabled] },
    })
  })
}
