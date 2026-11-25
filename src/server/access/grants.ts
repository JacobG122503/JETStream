/** Who may change whose access. Nobody raises their own, and nobody gives or takes what they do not have. */
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { grantedKeys, type Grants, missingFrom, permissionOf, type PermissionKey } from '../../shared/permissions'
import { lockKey } from '../auth/limits'
import type { Db, Tx } from '../db'
import { people, personCredentials, roles } from '../db/schema'
import { ApiError } from '../errors'
import { type Actor, currentActor, holdsAll, type Holdings, isSystem, type PersonAccess, type PersonActor } from './actor'
import { forbidden, holds, isManaged, requirePermission } from './decisions'

/**
 * Whatever changes someone's access, or makes a link that gives access, takes turns. Comes before
 * every other lock of the transaction.
 */
export const lockAccess = (tx: Tx) => lockKey(tx, 'access')

const sortedIds = (ids: readonly number[]) => [...new Set(ids)].sort((a, b) => a - b)

/**
 * Locks what a change of access depends on, always in the same order: the turn, people by id, roles
 * by id. Locks on emails and invites come between the first two, so take `lockAccess` yourself
 * before those. Returns the actor as of now: whoever lost access meanwhile has lost it here.
 */
export async function lockForAccessChange(
  tx: Tx, actor: Actor, also: { people?: readonly number[]; roles?: readonly number[] } = {},
): Promise<Actor> {
  await lockAccess(tx)
  const personIds = sortedIds([...(isSystem(actor) ? [] : [actor.id]), ...(also.people ?? [])])
  // Not "for update", which would also wait for whatever only refers to the rows.
  const locked = personIds.length === 0 ? [] : await tx
    .select({ roleId: people.roleId })
    .from(people)
    .where(inArray(people.id, personIds))
    .orderBy(asc(people.id))
    .for('no key update')
  const roleIds = sortedIds([...locked.map(({ roleId }) => roleId), ...(also.roles ?? [])])
  if (roleIds.length > 0) {
    await tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds)).orderBy(asc(roles.id)).for('no key update')
  }
  return currentActor(tx, actor)
}

export type Refusal = { code: 'forbidden' | 'own_access' | 'cannot_grant' | 'outranked'; message: string }

export const refuse = (refusal: Refusal | null): void => {
  if (refusal) throw refusal.code === 'forbidden' ? forbidden() : new ApiError(403, refusal.code, refusal.message)
}

const ownAccess: Refusal = { code: 'own_access', message: 'You cannot change your own access.' }

const administratorNeeded: Refusal = {
  code: 'cannot_grant', message: 'Only an administrator can give or take away the Administrator role.',
}

/** The first of what is missing, in words. */
function lacking(have: Grants, wanted: Grants): Refusal | null {
  const missing = missingFrom(have, wanted)
  const [key] = missing
  if (!key) return null
  const more = missing.length > 1 ? ` (and ${missing.length - 1} more)` : ''
  return {
    code: 'cannot_grant',
    message: `You can only give or take away permissions that you have yourself, at the same level. You do not have: ${permissionOf(key).label}${more}.`,
  }
}

/** Whether someone could give all of this, or take it away. */
export function checkHoldings(editor: Actor, wanted: Holdings): Refusal | null {
  if (isSystem(editor) || editor.administrator) return null
  return wanted.administrator ? administratorNeeded : lacking(editor.grants, wanted.grants)
}

export interface AccessChange {
  personId: number
  before: Holdings
  after: Holdings
  /** Managed projects and people added or removed. */
  changed?: { projects?: readonly number[]; people?: readonly number[] }
  /** Set when nothing but manager flags changes, which Administrators may do for themselves. */
  onlyFlags?: boolean
}

/** The grant rule. Null when the change is allowed. */
export function checkGrant(editor: Actor, { personId, before, after, changed = {}, onlyFlags = false }: AccessChange): Refusal | null {
  if (isSystem(editor)) return null
  if (!holds(editor, 'roles.manage', 'all')) return { code: 'forbidden', message: 'You do not have access to this' }
  if (editor.id === personId && !(onlyFlags && editor.administrator)) return ownAccess
  return checkHoldings(editor, before) ?? checkHoldings(editor, after) ?? checkManaged(editor, before, after, changed)
}

/** To let someone manage a project or person, one must hold their managed permissions for it. */
function checkManaged(editor: PersonActor, before: Holdings, after: Holdings, { projects = [], people: persons = [] }: NonNullable<AccessChange['changed']>): Refusal | null {
  if (editor.administrator) return null
  const managed = new Set<PermissionKey>(
    [before, after].flatMap(({ grants }) => grantedKeys(grants).filter((key) => grants[key] === 'managed')),
  )
  const covered = (key: PermissionKey) =>
    editor.grants[key] === 'all' ||
    (editor.grants[key] === 'managed' &&
      projects.every((projectId) => isManaged(editor, { type: 'project', projectId })) &&
      persons.every((personId) => isManaged(editor, { type: 'person', personId })))
  if (projects.length + persons.length === 0 || [...managed].every(covered)) return null
  return { code: 'cannot_grant', message: 'You can only let someone manage a project or person, or end it, if you have their permissions for it yourself.' }
}

/** The outranking rule, for acting on someone's account. Null when it is allowed. */
export function checkOutranks(actor: Actor, target: Holdings): Refusal | null {
  if (isSystem(actor)) return null
  if (!holds(actor, 'people.manage', 'all')) return { code: 'forbidden', message: 'You do not have access to this' }
  return holdsAll(actor, target)
    ? null
    : { code: 'outranked', message: 'Only someone with at least the same access as this person can do this.' }
}

/** Refuses unless the actor may act on the person's account. The caller has locked both. */
export function requireOutranks(actor: Actor, target: PersonAccess): void {
  requirePermission(actor, 'people.manage', 'all')
  refuse(checkOutranks(actor, target))
}

/** Active administrators who can sign in. */
export const administratorsWithPassword = (db: Db | Tx) =>
  db
    .select({ id: people.id })
    .from(people)
    .innerJoin(roles, eq(roles.id, people.roleId))
    .innerJoin(personCredentials, eq(personCredentials.personId, people.id))
    .where(and(eq(people.status, 'active'), eq(roles.key, 'administrator')))
    .$dynamic()

/**
 * Refuses when the person is the only active Administrator with a password. Call it before whatever
 * makes them stop being one (another role, archive, delete), in the same transaction and after
 * `lockForAccessChange`.
 */
export async function keepAnAdministrator(tx: Tx, personId: number): Promise<void> {
  await lockAccess(tx)
  const able = await administratorsWithPassword(tx)
  if (able.length !== 1 || able[0]?.id !== personId) return
  throw new ApiError(409, 'last_administrator', 'This is the only active administrator with a password. Make someone else an administrator first.')
}

/** Everyone with the role, by id. */
export const holdersOf = (db: Db | Tx, roleId: number, exceptId = 0) =>
  db.select({ id: people.id, name: people.name }).from(people).where(and(eq(people.roleId, roleId), ne(people.id, exceptId))).orderBy(asc(people.id))
