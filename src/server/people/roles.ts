/** Roles: the built-in ones to look at, the others to make and change. */
import { and, asc, count, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import type { RoleDetails, RoleSummary } from '../../shared/api'
import { builtInDescriptions, type BuiltInRole, builtInOrder, type Grants, roleGrants, writeGrants } from '../../shared/permissions'
import { type Actor, actorId, type Holdings, isSystem, readPersonAccess, type RoleRow } from '../access/actor'
import { requirePermission } from '../access/decisions'
import { checkHoldings, holdersOf, lockAccess, lockForAccessChange, refuse, type Refusal } from '../access/grants'
import { endLostLinks, roleHoldings } from '../access/links'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx, updateVersioned } from '../db'
import { invites, people, roles } from '../db/schema'
import { ApiError, NotFoundError, StaleError } from '../errors'
import { logActivity, logRoleActivity } from './activity'

const descriptionOf = (role: RoleRow) => (role.builtIn ? builtInDescriptions[role.key as BuiltInRole] : role.description)

const summaryOf = (role: RoleRow, holders: number): RoleSummary => ({
  id: role.id, key: role.key, builtIn: role.builtIn, name: role.name, description: descriptionOf(role), people: holders,
})

/** The built-in ones first, from the least to the most; the others stay as they are. */
export const rankOf = ({ key, builtIn }: Pick<RoleRow, 'key' | 'builtIn'>): number => (builtIn ? builtInOrder.indexOf(key as BuiltInRole) : builtInOrder.length)

export async function listRoles(db: Db, actor: Actor): Promise<RoleSummary[]> {
  requirePermission(actor, 'roles.manage', 'all')
  const rows = await db.select().from(roles).orderBy(asc(sql`not ${roles.builtIn}`), asc(sql`lower(${roles.name})`))
  const counts = await db.select({ roleId: people.roleId, holders: count() }).from(people).groupBy(people.roleId)
  return rows.map((role) => summaryOf(role, counts.find(({ roleId }) => roleId === role.id)?.holders ?? 0)).sort((a, b) => rankOf(a) - rankOf(b))
}

/** Invites that can still be used, or would be if their maker's access allowed it. */
const usableInvites = (roleId: number, now: Date) =>
  and(
    eq(invites.roleId, roleId), isNull(invites.acceptedAt), isNull(invites.revokedAt), isNull(invites.endedAt), gt(invites.expiresAt, now),
  )

export async function readRole(db: Db, actor: Actor, id: number, now: Date): Promise<RoleDetails> {
  requirePermission(actor, 'roles.manage', 'all')
  const [role] = await db.select().from(roles).where(eq(roles.id, id))
  if (!role) throw new NotFoundError(id)
  const holders = await holdersOf(db, id)
  return {
    ...summaryOf(role, holders.length),
    grants: roleGrants(role),
    version: role.version,
    invites: await db.$count(invites, usableInvites(id, now)),
    refusal: (await checkRoleEdit(db, actor, role))?.message ?? null,
  }
}

/** Whether the actor may change the role as it is: not built in, not their own, nothing in it that they lack. */
async function checkRoleEdit(db: Db | Tx, editor: Actor, role: RoleRow): Promise<Refusal | null> {
  if (role.builtIn) return { code: 'cannot_grant', message: 'Built-in roles cannot be changed.' }
  const own = isSystem(editor) ? undefined : await readPersonAccess(db, editor.id)
  if (own?.role.id === role.id) return { code: 'own_access', message: 'You cannot change the role you have yourself.' }
  return checkHoldings(editor, roleHoldings(role))
}

/** What each of them holds now, which may be a list of their own. */
async function holdingsOfAll(tx: Tx, holders: readonly { id: number }[]): Promise<Map<number, Holdings>> {
  const found = new Map<number, Holdings>()
  for (const { id } of holders) {
    const access = await readPersonAccess(tx, id)
    if (access) found.set(id, access)
  }
  return found
}

export interface RoleInput {
  name: string
  description: string
  grants: Grants
}

const reserved = ['administrator', 'manager', 'project manager', 'member', 'people admin', 'accounting', 'executive manager']

async function checkName(tx: Tx, name: string, exceptId = 0): Promise<void> {
  const same = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(sql`lower(${roles.name})`, sql`lower(${name})`), ne(roles.id, exceptId)))
  if (reserved.includes(name.toLowerCase())) throw invalidInput({ name: 'This is the name of a built-in role.' })
  if (same.length > 0) throw invalidInput({ name: 'There is already a role with this name.' })
}

const holdingsOf = (grants: Grants): Holdings => ({ administrator: false, grants })

export async function createRole(ctx: AppContext, actor: Actor, { name, description, grants }: RoleInput): Promise<number> {
  return runTransaction(ctx.db, async (tx) => {
    const editor = await lockForAccessChange(tx, actor)
    requirePermission(editor, 'roles.manage', 'all')
    refuse(checkHoldings(editor, holdingsOf(grants)))
    await checkName(tx, name)
    const [role] = await tx.insert(roles).values({ name, description, permissions: writeGrants(grants) }).returning({ id: roles.id })
    const roleId = role?.id ?? 0
    await logRoleActivity(tx, actor, {
      action: 'role_created', roleId, summary: `Created the role ${name}`,
      changes: { name: [null, name], description: [null, description], permissions: [null, writeGrants(grants)] },
    })
    return roleId
  })
}

export async function updateRole(
  ctx: AppContext, actor: Actor, id: number, { name, description, grants, version }: RoleInput & { version: number },
): Promise<void> {
  await runTransaction(ctx.db, async (tx) => {
    const editor = await lockForAccessChange(tx, actor, { roles: [id] })
    requirePermission(editor, 'roles.manage', 'all')
    const [role] = await tx.select().from(roles).where(eq(roles.id, id))
    if (!role) throw new NotFoundError(id)
    refuse(await checkRoleEdit(tx, editor, role))
    refuse(checkHoldings(editor, holdingsOf(grants)))
    if (role.version !== version) throw new StaleError(id, version)
    await checkName(tx, name, id)
    const before = roleHoldings(role)
    const holders = await holdersOf(tx, id)
    const held = await holdingsOfAll(tx, holders)
    await updateVersioned(tx, roles, id, version, { name, description, permissions: writeGrants(grants) })
    await endLostLinks(tx, ctx.now(), held)
    await logRoleActivity(tx, actor, {
      action: 'role_changed', roleId: id, summary: `Changed the role ${name}`,
      changes: {
        name: [role.name, name], description: [role.description, description],
        permissions: [writeGrants(before.grants), writeGrants(grants)], people: holders.length,
      },
    })
  })
}

/** Removes a role. Who holds it, and open invites with it, get the replacement. */
export async function deleteRole(
  ctx: AppContext, actor: Actor, id: number, { version, replacementId }: { version: number; replacementId: number | null },
): Promise<void> {
  const now = ctx.now()
  await runTransaction(ctx.db, async (tx) => {
    // Before the holders are read, so that nobody gets the role meanwhile.
    await lockAccess(tx)
    const holders = await holdersOf(tx, id)
    const editor = await lockForAccessChange(tx, actor, {
      people: holders.map((holder) => holder.id), roles: replacementId === null ? [id] : [id, replacementId],
    })
    requirePermission(editor, 'roles.manage', 'all')
    const [role] = await tx.select().from(roles).where(eq(roles.id, id))
    if (!role) throw new NotFoundError(id)
    refuse(await checkRoleEdit(tx, editor, role))
    if (role.version !== version) throw new StaleError(id, version)
    const replacement = replacementId === null ? undefined : (await tx.select().from(roles).where(eq(roles.id, replacementId)))[0]
    if (replacementId !== null && (!replacement || replacement.id === id)) throw invalidInput({ replacementId: 'Choose another role.' })
    if (replacement) refuse(checkHoldings(editor, roleHoldings(replacement)))
    const open = await tx.$count(invites, usableInvites(id, now))
    if (!replacement && (holders.length > 0 || open > 0)) {
      throw new ApiError(409, 'role_in_use', `This role is used by ${holders.length} people and ${open} open invites. Choose another role for them.`)
    }

    const before = roleHoldings(role)
    const held = await holdingsOfAll(tx, holders)
    for (const holdings of held.values()) refuse(checkHoldings(editor, holdings))
    if (replacement) {
      await tx.update(people).set({ roleId: replacement.id, permissions: null }).where(eq(people.roleId, id))
      await tx
        .update(invites)
        .set({ roleId: replacement.id })
        .where(and(eq(invites.roleId, id), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
    }
    // Invites of the past only tell the name.
    await tx.update(invites).set({ roleId: null, roleName: role.name }).where(eq(invites.roleId, id))
    await tx.delete(roles).where(eq(roles.id, id))
    await endLostLinks(tx, now, held)
    for (const holder of holders) {
      await logActivity(tx, {
        actorId: actorId(actor), action: 'access_changed', personId: holder.id, summary: `Changed the access of ${holder.name}`,
        changes: { role: [role.name, replacement?.name ?? null] },
      })
    }
    await logRoleActivity(tx, actor, {
      action: 'role_deleted', roleId: id, summary: `Deleted the role ${role.name}`,
      changes: {
        name: [role.name, null], description: [role.description, null], permissions: [writeGrants(before.grants), null],
        replacement: replacement?.name ?? null, people: holders.length, invites: open,
      },
    })
  })
}
