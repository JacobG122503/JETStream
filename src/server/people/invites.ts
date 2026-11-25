import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Request } from 'express'
import type { InviteInfo, InviteRow, InviteStatus, NewLink } from '../../shared/api'
import { type Actor, actorId, isSystem, loadActor, type PersonAccess, type PersonActor, readPersonAccess } from '../access/actor'
import { requirePermission } from '../access/decisions'
import { lockAccess, lockForAccessChange } from '../access/grants'
import { endLostLinks, mayInvite, requireInvite as requireMayInvite } from '../access/links'
import { hashToken, isToken, newToken } from '../auth/tokens'
import { createSession, type NewSession } from '../auth/sessions'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx } from '../db'
import { helpRequests, inviteClients, inviteProjects, invites, people, personCredentials, personExtras, roles } from '../db/schema'
import { inviteText } from '../email/messages'
import { sendEmail } from '../email/sender'
import { ApiError } from '../errors'
import { hashPassword } from '../security/passwords'
import { logActivity } from './activity'
import { addAssignments, type Assignments, checkAssignments } from './assignments'
import { linkInvalid, linkTo } from './links'
import { findPersonByEmail, getSettings, lockEmail, lockPerson, requireRole } from './lookup'
import { checkNewPassword } from './newPassword'

const inviteMs = 7 * 24 * 3_600_000

const creators = alias(people, 'creators')

/** Invites with what decides whether their link works. */
const selectInvites = (db: Db | Tx) =>
  db
    .select({ invite: invites, role: roles, creator: { id: creators.id, name: creators.name } })
    .from(invites)
    .leftJoin(roles, eq(roles.id, invites.roleId))
    .innerJoin(creators, eq(creators.id, invites.createdBy))

type Row = Awaited<ReturnType<typeof selectInvites>>[number]

const roleName = ({ invite, role }: Row): string => role?.name ?? invite.roleName ?? ''

/** Tells the status of invites as of now. Asks the database once for each maker and address. */
function judge(db: Db | Tx, now: Date) {
  const makers = new Map<number, Promise<PersonActor>>()
  const targets = new Map<string, Promise<PersonAccess | undefined>>()
  const remember = <K, V>(map: Map<K, Promise<V>>, key: K, read: () => Promise<V>) => {
    const value = map.get(key) ?? read()
    map.set(key, value)
    return value
  }
  return async ({ invite, role }: Row): Promise<InviteStatus> => {
    if (invite.acceptedAt) return 'accepted'
    // Replaced after it had expired.
    if (invite.revokedAt) return invite.expiresAt <= invite.revokedAt ? 'expired' : 'revoked'
    if (invite.expiresAt <= now) return 'expired'
    if (invite.endedAt || !role) return 'void'
    const maker = await remember(makers, invite.createdBy, () => loadActor(db, invite.createdBy))
    const email = invite.email.toLowerCase()
    const target = await remember(targets, email, async () => {
      const found = await findPersonByEmail(db, email)
      return found && readPersonAccess(db, found.person.id)
    })
    return mayInvite(maker, role, target) ? 'open' : 'void'
  }
}

async function openAmong(db: Db | Tx, rows: Row[], now: Date): Promise<Row[]> {
  const statusOf = judge(db, now)
  const open: Row[] = []
  for (const row of rows) if ((await statusOf(row)) === 'open') open.push(row)
  return open
}

/** Whether someone can still use an invite for this email. */
export async function hasOpenInvite(db: Db | Tx, email: string, now: Date, exceptId = 0): Promise<boolean> {
  const rows = await selectInvites(db).where(and(eq(sql`lower(${invites.email})`, email), ne(invites.id, exceptId)))
  return (await openAmong(db, rows, now)).length > 0
}

/** Emails of people without a password who have an open invite. */
export async function openInviteEmails(db: Db, now: Date): Promise<Set<string>> {
  const rows = await selectInvites(db).where(and(isNull(invites.acceptedAt), isNull(invites.revokedAt)))
  return new Set((await openAmong(db, rows, now)).map(({ invite }) => invite.email.toLowerCase()))
}

export async function listInvites(db: Db, actor: Actor, now: Date): Promise<InviteRow[]> {
  requirePermission(actor, 'people.manage', 'all')
  const rows = await selectInvites(db).orderBy(desc(invites.createdAt), desc(invites.id))
  const statusOf = judge(db, now)
  const list: InviteRow[] = []
  for (const row of rows) {
    list.push({
      id: row.invite.id,
      name: row.invite.name,
      email: row.invite.email,
      role: roleName(row),
      status: await statusOf(row),
      invitedBy: row.creator.name,
      createdAt: row.invite.createdAt.toISOString(),
      expiresAt: row.invite.expiresAt.toISOString(),
      acceptedAt: row.invite.acceptedAt?.toISOString() ?? null,
      revokedAt: row.invite.revokedAt?.toISOString() ?? null,
    })
  }
  return list
}

/** Why this email cannot be invited now. Returns the person an invite would give a password to. */
async function checkCanInvite(tx: Tx, email: string, now: Date, exceptId?: number) {
  const refuse = (code: string, message: string) => new ApiError(409, code, message)
  const found = await findPersonByEmail(tx, email)
  if (found?.person.status === 'pending') {
    throw refuse('pending_request', 'This address is waiting for approval. Decide on the request instead.')
  }
  if (found?.person.status === 'archived') throw refuse('archived', 'This address belongs to an archived person.')
  if (found?.passwordHash) throw refuse('has_password', 'This person already has a password. Make a reset link instead.')
  if (await hasOpenInvite(tx, email, now, exceptId)) {
    throw refuse('open_invite', 'This address already has an open invite. Make a new link for it, or revoke it first.')
  }
  return found?.person
}

export interface InviteInput extends Assignments {
  name: string
  email: string
  roleId: number
}

/** Whoever makes a link is a person: the invite names them, and they answer for it. */
function requireMaker(actor: Actor): PersonActor {
  if (isSystem(actor)) throw new Error('Invites are made by people')
  return actor
}

/** Locks maker, invited person and role, and returns the maker as of now with the invited person. */
async function lockToInvite(tx: Tx, actor: Actor, email: string, roleId: number | null) {
  const found = await findPersonByEmail(tx, email)
  const also = { people: found ? [found.person.id] : [], roles: roleId === null ? [] : [roleId] }
  const maker = requireMaker(await lockForAccessChange(tx, actor, also))
  requirePermission(maker, 'people.manage', 'all')
  return { maker, target: found && (await readPersonAccess(tx, found.person.id)) }
}

export async function createInvite(ctx: AppContext, actor: Actor, input: InviteInput): Promise<NewLink> {
  const { name, email, roleId } = input
  const now = ctx.now()
  const token = newToken()
  const expiresAt = new Date(now.getTime() + inviteMs)
  const by = requireMaker(actor)
  const inviteId = await runTransaction(ctx.db, async (tx) => {
    await lockAccess(tx)
    await lockEmail(tx, email)
    const { maker, target } = await lockToInvite(tx, by, email, roleId)
    const person = await checkCanInvite(tx, email, now)
    const role = await requireRole(tx, roleId)
    requireMayInvite(maker, role, target)
    const { clientIds, projectIds } = await checkAssignments(tx, input)
    // Expired and void invites for the address make way.
    await tx
      .update(invites)
      .set({ revokedAt: now, tokenHash: null })
      .where(and(eq(sql`lower(${invites.email})`, email), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
    const [invite] = await tx
      .insert(invites)
      .values({
        tokenHash: hashToken(token), name, email, roleId, personId: person?.id ?? null, createdBy: by.id, expiresAt,
        createdAt: now,
      })
      .returning({ id: invites.id })
    const id = invite?.id ?? 0
    if (clientIds.length > 0) await tx.insert(inviteClients).values(clientIds.map((clientId) => ({ inviteId: id, clientId })))
    if (projectIds.length > 0) await tx.insert(inviteProjects).values(projectIds.map((projectId) => ({ inviteId: id, projectId })))
    if (person) await closeHelpRequests(tx, person.id, now)
    await logActivity(tx, {
      actorId: by.id, action: 'invited', personId: person?.id ?? null, summary: `Invited ${name} (${email}) as ${role.name}`,
      changes: { inviteId: id, email, role: role.name, clientIds, projectIds },
    })
    return id
  })
  return handOver(ctx, { id: inviteId, name, email }, token, expiresAt, by)
}

/** Replaces the link of an invite that nobody used; the old link stops working, if it did not before. */
export async function renewInvite(ctx: AppContext, actor: Actor, id: number): Promise<NewLink> {
  const now = ctx.now()
  const token = newToken()
  const expiresAt = new Date(now.getTime() + inviteMs)
  const by = requireMaker(actor)
  const invite = await runTransaction(ctx.db, async (tx) => {
    await lockAccess(tx)
    requirePermission(by, 'people.manage', 'all')
    const [found] = await tx.select().from(invites).where(eq(invites.id, id))
    if (!found) throw new ApiError(404, 'not_found', 'Not found')
    const email = found.email.toLowerCase()
    await lockEmail(tx, email)
    const locked = await lockInvite(tx, eq(invites.id, id))
    const { maker, target } = await lockToInvite(tx, by, email, locked?.roleId ?? null)
    if (!locked || locked.acceptedAt || locked.revokedAt) throw alreadyHandled()
    if (locked.roleId === null) {
      throw new ApiError(409, 'role_deleted', `The role ${locked.roleName} of this invite was deleted. Invite the person again.`)
    }
    const person = await checkCanInvite(tx, email, now, id)
    requireMayInvite(maker, await requireRole(tx, locked.roleId), target)
    await tx
      .update(invites)
      .set({ tokenHash: hashToken(token), expiresAt, endedAt: null, createdBy: by.id, personId: person?.id ?? null })
      .where(eq(invites.id, id))
    if (person) await closeHelpRequests(tx, person.id, now)
    await logActivity(tx, {
      actorId: by.id, action: 'invite_renewed', personId: person?.id ?? null,
      summary: `Made a new invite link for ${locked.name} (${locked.email})`, changes: { inviteId: id, email: locked.email },
    })
    return locked
  })
  return handOver(ctx, invite, token, expiresAt, by)
}

async function handOver(
  ctx: AppContext, invite: { id: number; name: string; email: string }, token: string, expiresAt: Date, by: PersonActor,
): Promise<NewLink> {
  const link = linkTo(ctx, 'invite', token)
  const { name: company } = await getSettings(ctx.db)
  await sendEmail(ctx.email, {
    ...inviteText(invite.name, company, by.name), to: { name: invite.name, email: invite.email }, link, createdBy: by.id,
  })
  return { link, expiresAt: expiresAt.toISOString(), emailed: ctx.email.delivers }
}

export async function revokeInvite(ctx: AppContext, actor: Actor, id: number): Promise<void> {
  const now = ctx.now()
  await runTransaction(ctx.db, async (tx) => {
    await lockAccess(tx)
    const invite = await lockInvite(tx, eq(invites.id, id))
    requirePermission(await lockForAccessChange(tx, actor), 'people.manage', 'all')
    if (!invite) throw new ApiError(404, 'not_found', 'Not found')
    if (invite.acceptedAt || invite.revokedAt) throw alreadyHandled()
    await tx.update(invites).set({ revokedAt: now, tokenHash: null }).where(eq(invites.id, id))
    await logActivity(tx, {
      actorId: actorId(actor), action: 'invite_revoked', personId: invite.personId,
      summary: `Revoked the invite of ${invite.name} (${invite.email})`, changes: { inviteId: id, email: invite.email },
    })
  })
}

const alreadyHandled = () => new ApiError(409, 'already_handled', 'This was already handled. The list is up to date now.')

async function lockInvite(tx: Tx, condition: ReturnType<typeof eq>) {
  const [invite] = await tx.select().from(invites).where(condition).for('update')
  return invite
}

/** The invite a working link belongs to; throws when the link does not work, whatever the reason. */
async function requireInvite(db: Db | Tx, token: unknown, now: Date) {
  if (!isToken(token)) throw linkInvalid()
  const [row] = await selectInvites(db).where(eq(invites.tokenHash, hashToken(token)))
  if (!row?.role || (await judge(db, now)(row)) !== 'open') throw linkInvalid()
  const found = await findPersonByEmail(db, row.invite.email.toLowerCase())
  // The person may have been archived, or got a password, in the meantime.
  if (found && (found.person.status !== 'active' || found.passwordHash)) throw linkInvalid()
  return { invite: row.invite, role: row.role, person: found?.person }
}

/** What the page of an invite link shows. Does not use the link up. */
export async function readInvite(ctx: AppContext, token: unknown): Promise<InviteInfo> {
  const { invite, role, person } = await requireInvite(ctx.db, token, ctx.now())
  const { name: company, timeZone: companyTimeZone } = await getSettings(ctx.db)
  return { company, companyTimeZone, name: person?.name ?? invite.name, email: invite.email, role: role.name }
}

export interface AcceptInput {
  token: unknown
  name: string
  password: string
  timeZone: string
}

/** Uses an invite link: the person becomes active with a password, and is signed in. */
export async function acceptInvite(ctx: AppContext, req: Request, input: AcceptInput): Promise<NewSession> {
  // Looked at before hashing, which is slow, and again inside the transaction.
  const { invite } = await requireInvite(ctx.db, input.token, ctx.now())
  checkNewPassword(input.password, invite.email)
  const passwordHash = await hashPassword(input.password)
  const { name, timeZone } = input
  return runTransaction(ctx.db, async (tx) => {
    const now = ctx.now()
    await lockAccess(tx)
    await lockEmail(tx, invite.email.toLowerCase())
    await lockInvite(tx, eq(invites.id, invite.id))
    const { person: invited, invite: locked, role: given } = await requireInvite(tx, input.token, now)
    const maker = await lockForAccessChange(tx, await loadActor(tx, locked.createdBy), {
      people: invited ? [invited.id] : [], roles: [given.id],
    })
    // May be archived, or given a password on the server, at the same time; so once more when locked.
    if (invited) await lockPerson(tx, invited.id)
    const current = await requireInvite(tx, input.token, now)
    const { email } = current.invite
    const roleId = current.role.id
    const before = current.person && (await readPersonAccess(tx, current.person.id))
    let personId: number
    if (current.person) {
      personId = current.person.id
      await tx.update(people).set({ name, timeZone, roleId, permissions: null }).where(eq(people.id, personId))
      await tx.delete(personExtras).where(eq(personExtras.personId, personId))
      if (before) await endLostLinks(tx, now, new Map([[personId, before]]))
    } else {
      const [person] = await tx
        .insert(people)
        .values({ name, email: email.toLowerCase(), timeZone, roleId, status: 'active' })
        .returning({ id: people.id })
      personId = person?.id ?? 0
    }
    await tx.insert(personCredentials).values({ personId, passwordHash, changedAt: now })
    const chosenClients = await tx.select().from(inviteClients).where(eq(inviteClients.inviteId, invite.id))
    const chosenProjects = await tx.select().from(inviteProjects).where(eq(inviteProjects.inviteId, invite.id))
    const target = await readPersonAccess(tx, personId)
    if (!target) throw linkInvalid()
    await addAssignments(tx, maker, target, {
      clientIds: chosenClients.map(({ clientId }) => clientId),
      projectIds: chosenProjects.map(({ projectId }) => projectId),
    })
    await tx.update(invites).set({ acceptedAt: now, personId, tokenHash: null }).where(eq(invites.id, invite.id))
    await closeHelpRequests(tx, personId, now)
    await logActivity(tx, {
      actorId: personId, action: 'invite_accepted', personId, summary: `${name} accepted the invite (${email}, ${current.role.name})`,
      changes: {
        inviteId: invite.id, role: [before?.role.name ?? null, current.role.name], extras: [before?.extras ?? [], []],
        givenBy: current.invite.createdBy,
      },
    })
    return createSession(tx, ctx, req, personId, false)
  })
}

export async function closeHelpRequests(tx: Tx, personId: number, now: Date): Promise<void> {
  await tx
    .update(helpRequests)
    .set({ closedAt: now })
    .where(and(eq(helpRequests.personId, personId), isNull(helpRequests.closedAt)))
}

/** The tokens of invites that can never be used again are erased; the invites stay in the list. */
export async function removeOldInviteLinks(db: Db, now: Date): Promise<void> {
  await db
    .update(invites)
    .set({ tokenHash: null, version: sql`${invites.version}` })
    .where(
      and(
        sql`${invites.tokenHash} is not null`,
        or(sql`${invites.expiresAt} <= ${now.toISOString()}::timestamptz`, sql`${invites.acceptedAt} is not null or ${invites.revokedAt} is not null`),
      ),
    )
}
