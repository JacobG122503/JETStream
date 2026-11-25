/** Who may make an invite or reset link. Asked when it is made, when it is used, and when access changes. */
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { grantedKeys, type Grants, type Level, reaches, roleGrants, isAdministratorRole } from '../../shared/permissions'
import type { Db, Tx } from '../db'
import { invites, passwordResets, people, roles } from '../db/schema'
import { type Actor, holdsAll, type Holdings, isSystem, type PersonAccess, readPersonAccess, type RoleRow } from './actor'
import { checkGrant, checkHoldings, checkOutranks, refuse, type Refusal } from './grants'
import { holds, requirePermission } from './decisions'

function union(...lists: Grants[]): Grants {
  const all: Record<string, Level> = {}
  for (const grants of lists) {
    for (const key of grantedKeys(grants)) if (all[key] !== 'all') all[key] = grants[key] ?? 'managed'
  }
  return all as Grants
}

/** What a role gives to someone new to it: without extras. */
export const roleHoldings = (role: RoleRow): Holdings => ({ administrator: isAdministratorRole(role), grants: roleGrants(role) })

const isMemberRole = (role: RoleRow) => role.builtIn && role.key === 'member'

/** Whether giving the role changes someone's access. For someone new, every role but Member does. */
export const changesAccess = (role: RoleRow, target?: PersonAccess): boolean =>
  !isMemberRole(role) || (target !== undefined && !(isMemberRole(target.role) && target.extras.length === 0 && !target.customized))

/** Everything it takes to invite someone with this role. */
export function inviteNeeds(role: RoleRow, target?: PersonAccess): Holdings {
  const given = roleHoldings(role)
  const change = changesAccess(role, target)
  return {
    administrator: given.administrator || (target?.administrator ?? false),
    grants: union(
      { 'people.manage': 'all' }, target?.grants ?? {}, change ? { 'roles.manage': 'all' } : {}, change ? given.grants : {},
    ),
  }
}

/** Everything it takes to make a reset link. */
export const resetNeeds = (target: Holdings): Holdings => ({
  administrator: target.administrator, grants: union({ 'people.manage': 'all' }, target.grants),
})

/** Refuses someone who may not invite this person with this role. */
export function requireInvite(actor: Actor, role: RoleRow, target?: PersonAccess): void {
  requirePermission(actor, 'people.manage', 'all')
  if (target) refuse(checkOutranks(actor, target))
  refuse(checkNewRole(actor, role, target))
}

/** Whether the actor may give the role to someone who joins, or is invited. Null when they may. */
export function checkNewRole(actor: Actor, role: RoleRow, target?: PersonAccess): Refusal | null {
  if (!changesAccess(role, target)) return null
  const none: Holdings = { administrator: false, grants: {} }
  return checkGrant(actor, { personId: target?.person.id ?? 0, before: target ?? none, after: roleHoldings(role) })
}

/** Whether the role can be offered to the actor for someone new. */
export const mayGiveRole = (actor: Actor, role: RoleRow): boolean =>
  isMemberRole(role) || (holds(actor, 'roles.manage', 'all') && checkHoldings(actor, roleHoldings(role)) === null)

/** Whether the maker of an invite could make it now. */
export function mayInvite(maker: Actor, role: RoleRow, target?: PersonAccess): boolean {
  if (!isSystem(maker) && target?.person.id === maker.id) return false
  return isSystem(maker) || holdsAll(maker, inviteNeeds(role, target))
}

export const mayReset = (maker: Actor, target: Holdings): boolean => isSystem(maker) || holdsAll(maker, resetNeeds(target))

/** Whether someone who had what it takes has lost some of it. */
function lost(before: Holdings, after: Holdings, needs: Holdings): boolean {
  if (holdsAll(after, needs)) return false
  if (needs.administrator && !after.administrator) return before.administrator || lostGrants(before, after, needs)
  return lostGrants(before, after, needs)
}

const lostGrants = (before: Holdings, after: Holdings, needs: Holdings) =>
  grantedKeys(needs.grants).some((key) => {
    const level = needs.grants[key] ?? 'managed'
    return !reaches(after.grants[key], level) && reaches(before.grants[key], level)
  })

/** The person an email belongs to. */
async function accessByEmail(db: Db | Tx, email: string): Promise<PersonAccess | undefined> {
  const [row] = await db.select({ id: people.id }).from(people).where(eq(sql`lower(${people.email})`, email.toLowerCase()))
  return row && readPersonAccess(db, row.id)
}

/**
 * Ends the unused links of people whose role, extras or role's content changed, as far as they lost
 * what it takes to make them. Called after the change, in its transaction, with what they held
 * before. These links do not work again, whatever happens later.
 */
export async function endLostLinks(tx: Tx, now: Date, changed: ReadonlyMap<number, Holdings>): Promise<void> {
  for (const [makerId, before] of changed) {
    const after = await readPersonAccess(tx, makerId)
    if (!after) continue
    const open = await tx
      .select({ invite: invites, role: roles })
      .from(invites)
      .innerJoin(roles, eq(roles.id, invites.roleId))
      .where(
        and(
          eq(invites.createdBy, makerId), isNull(invites.acceptedAt), isNull(invites.revokedAt), isNull(invites.endedAt),
          gt(invites.expiresAt, now),
        ),
      )
    for (const { invite, role } of open) {
      if (!lost(before, after, inviteNeeds(role, await accessByEmail(tx, invite.email)))) continue
      await tx.update(invites).set({ endedAt: now, tokenHash: null }).where(eq(invites.id, invite.id))
    }
    const resets = await tx
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.createdBy, makerId), isNull(passwordResets.usedAt), isNull(passwordResets.revokedAt)))
    for (const reset of resets) {
      const target = await readPersonAccess(tx, reset.personId)
      if (!target || !lost(before, after, resetNeeds(target))) continue
      await tx.update(passwordResets).set({ revokedAt: now }).where(eq(passwordResets.id, reset.id))
    }
  }
}
