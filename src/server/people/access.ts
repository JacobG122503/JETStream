/** What each person may do, and who may change it. */
import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { AccessInfo, AccessInput, AccessPerson, AccessProject, PersonAccessDetails } from '../../shared/api'
import { isAdministratorRole, managerExtras, managerGrants, problemWithExtras, roleGrants } from '../../shared/permissions'
import { type Actor, actorId, type Holdings, type PersonAccess, readPersonAccess } from '../access/actor'
import { ownId, requirePermission, requireRecord } from '../access/decisions'
import { checkGrant, checkHoldings, keepAnAdministrator, lockForAccessChange, refuse } from '../access/grants'
import { endLostLinks, roleHoldings } from '../access/links'
import { writeManagerFlag } from '../access/managerFlags'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx } from '../db'
import { clients, people, personExtras, personManagers, projectMembers, projects, roles } from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { logActivity } from './activity'
import { requireRole } from './lookup'
import { isCurrentMembership } from './membership'

interface Managing {
  people: AccessPerson[]
  /** Every project the person is on, whether they manage it or not. */
  projects: AccessProject[]
}

async function readManaging(db: Db | Tx, personId: number): Promise<Managing> {
  const managed = await db
    .select({ id: people.id, name: people.name, status: people.status })
    .from(personManagers)
    .innerJoin(people, eq(people.id, personManagers.personId))
    .where(eq(personManagers.managerId, personId))
    .orderBy(asc(sql`lower(${people.name})`), asc(people.id))
  const memberships = await db
    .select({
      id: projects.id, name: projects.name, client: clients.name, isManager: projectMembers.isManager,
      archivedAt: projects.archivedAt, clientArchivedAt: clients.archivedAt,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projectMembers.personId, personId), isCurrentMembership()))
    .orderBy(asc(sql`lower(${projects.name})`), asc(projects.id))
  return {
    people: managed.map(({ id, name, status }) => ({ id, name, active: status === 'active' })),
    projects: memberships.map(({ id, name, client, isManager, archivedAt, clientArchivedAt }) => ({
      id, name, client, isManager, archived: archivedAt !== null || clientArchivedAt !== null,
    })),
  }
}

const idsOf = (list: { id: number }[]) => list.map(({ id }) => id)
const managedOf = ({ projects: list }: Managing) => list.filter(({ isManager }) => isManager)

/** Changes whenever the access does, whoever changes it. */
function stateOf({ role, extras }: PersonAccess, managing: Managing): string {
  const list = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',')
  const parts = [role.id, extras.join(','), list(idsOf(managing.people)), list(idsOf(managing.projects)), list(idsOf(managedOf(managing)))]
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
}

/** One's own access, to look at. */
export async function readOwnAccess(db: Db, actor: Actor): Promise<AccessInfo> {
  const id = ownId(actor)
  const access = await readPersonAccess(db, id)
  if (!access) throw new NotFoundError(id)
  const managing = await readManaging(db, id)
  return {
    role: { key: access.role.key, name: access.role.name },
    administrator: access.administrator,
    grants: access.grants,
    managedProjects: managedOf(managing).map(({ name }) => name),
    managedPeople: managing.people.map(({ name }) => name),
  }
}

function editableBy(actor: Actor, target: PersonAccess): Pick<PersonAccessDetails, 'editable' | 'reason'> {
  if (target.person.status !== 'active') return { editable: 'none', reason: 'Only the access of active people can be changed.' }
  const whole = checkGrant(actor, { personId: target.person.id, before: target, after: target })
  if (!whole) return { editable: 'all', reason: null }
  const flags = checkGrant(actor, { personId: target.person.id, before: target, after: target, onlyFlags: true })
  return { editable: flags ? 'none' : 'flags', reason: whole.message }
}

/** Someone's access with what can be chosen instead. */
export async function readAccessOf(db: Db, actor: Actor, personId: number): Promise<PersonAccessDetails> {
  requirePermission(actor, 'roles.manage', 'all')
  requireRecord(actor, { view: 'people.view' }, { type: 'person', personId }, personId)
  const target = await readPersonAccess(db, personId)
  if (!target) throw new NotFoundError(personId)
  const managing = await readManaging(db, personId)
  const allRoles = await db.select().from(roles).orderBy(asc(sql`not ${roles.builtIn}`), asc(sql`lower(${roles.name})`))
  const candidates = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(and(eq(people.status, 'active'), ne(people.id, personId)))
    .orderBy(asc(sql`lower(${people.name})`), asc(people.id))
  return {
    state: stateOf(target, managing),
    ...editableBy(actor, target),
    roleId: target.role.id,
    extras: target.extras,
    refusedExtras: managerExtras.filter((key) => {
      const level = managerGrants([key])[key]
      return checkHoldings(actor, { administrator: false, grants: { [key]: level } }) !== null
    }),
    managedPeople: managing.people,
    projects: managing.projects,
    roles: allRoles.map((role) => ({
      id: role.id, key: role.key, name: role.name, builtIn: role.builtIn, grants: roleGrants(role),
      refusal: checkHoldings(actor, roleHoldings(role))?.message ?? null,
    })),
    people: candidates.map((person) => ({ ...person, active: true })),
  }
}

/** In one list but not in the other. */
const difference = (a: readonly number[], b: readonly number[]) => [...a.filter((id) => !b.includes(id)), ...b.filter((id) => !a.includes(id))]

/** Changes someone's role, extras, managed people and manager flags, all or nothing. */
export async function saveAccess(ctx: AppContext, actor: Actor, personId: number, input: AccessInput): Promise<void> {
  const { roleId, extras, managedPersonIds, managedProjectIds } = input
  await runTransaction(ctx.db, async (tx) => {
    const editor = await lockForAccessChange(tx, actor, { people: [personId, ...managedPersonIds], roles: [roleId] })
    requirePermission(editor, 'roles.manage', 'all')
    requireRecord(editor, { view: 'people.view' }, { type: 'person', personId }, personId)
    const target = await readPersonAccess(tx, personId)
    if (!target) throw new NotFoundError(personId)
    const managing = await readManaging(tx, personId)
    const before = { people: idsOf(managing.people), projects: idsOf(managedOf(managing)) }
    const role = await requireRole(tx, roleId)
    const isManager = role.builtIn && role.key === 'manager'
    if (extras.length > 0 && !isManager) throw invalidInput({ extras: 'Only people with the role Manager can have extras.' })
    const wrongExtras = problemWithExtras(extras)
    if (wrongExtras) throw invalidInput({ extras: wrongExtras })

    const after: Holdings = { administrator: isAdministratorRole(role), grants: roleGrants(role, extras) }
    const roleChanged = role.id !== target.role.id
    const extrasChanged = [...extras].sort().join() !== [...target.extras].sort().join()
    const changed = { people: difference(before.people, managedPersonIds), projects: difference(before.projects, managedProjectIds) }
    const onlyFlags = !roleChanged && !extrasChanged && changed.people.length === 0
    refuse(checkGrant(editor, { personId, before: target, after, changed, onlyFlags }))
    if (target.person.status !== 'active') throw new ApiError(409, 'not_active', 'Only the access of active people can be changed.')
    if (stateOf(target, managing) !== input.state) {
      throw new ApiError(409, 'stale', 'Someone else changed this in the meantime. Reload to see the change.')
    }
    if (target.administrator && !after.administrator) await keepAnAdministrator(tx, personId)

    await checkChosen(tx, personId, managedPersonIds.filter((id) => !before.people.includes(id)))
    if (managedProjectIds.some((id) => !idsOf(managing.projects).includes(id))) {
      throw invalidInput({ managedProjectIds: 'Only people on a project can manage it.' })
    }

    if (roleChanged) await tx.update(people).set({ roleId }).where(eq(people.id, personId))
    if (roleChanged || extrasChanged) {
      await tx.delete(personExtras).where(eq(personExtras.personId, personId))
      if (extras.length > 0) await tx.insert(personExtras).values(extras.map((permission) => ({ personId, permission })))
      await endLostLinks(tx, ctx.now(), new Map([[personId, target]]))
    }
    if (changed.people.length > 0) {
      const removed = before.people.filter((id) => !managedPersonIds.includes(id))
      const added = managedPersonIds.filter((id) => !before.people.includes(id))
      if (removed.length > 0) {
        await tx.delete(personManagers).where(and(eq(personManagers.managerId, personId), inArray(personManagers.personId, removed)))
      }
      if (added.length > 0) await tx.insert(personManagers).values(added.map((id) => ({ personId: id, managerId: personId })))
    }
    for (const projectId of changed.projects) {
      await writeManagerFlag(tx, personId, projectId, managedProjectIds.includes(projectId))
    }

    const names = (list: { name: string }[]) => list.map(({ name }) => name)
    const now = await readManaging(tx, personId)
    const changes = {
      ...(roleChanged && { role: [target.role.name, role.name] }),
      ...(extrasChanged && { extras: [target.extras, extras] }),
      ...(changed.people.length > 0 && { managedPeople: [names(managing.people), names(now.people)] }),
      ...(changed.projects.length > 0 && { managedProjects: [names(managedOf(managing)), names(managedOf(now))] }),
    }
    if (Object.keys(changes).length === 0) return
    await logActivity(tx, {
      actorId: actorId(actor), action: 'access_changed', personId, summary: `Changed the access of ${target.person.name}`, changes,
    })
  })
}

/** Managed people are active, and nobody manages themselves. */
async function checkChosen(tx: Tx, managerId: number, added: number[]): Promise<void> {
  if (added.length === 0) return
  const found = await tx.select({ id: people.id }).from(people).where(and(inArray(people.id, added), eq(people.status, 'active')))
  if (added.includes(managerId) || found.length < added.length) {
    throw invalidInput({ managedPersonIds: 'Choose active people from the list.' })
  }
}
