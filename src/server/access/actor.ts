/** Who acts, with what they may do, as it is in the database now. */
import { createHash } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { grantedKeys, type Grants, isAdministratorRole, managerExtras, type PermissionKey, reaches, roleGrants } from '../../shared/permissions'
import type { Db, Tx } from '../db'
import { people, personExtras, personManagers, projectMembers, projects, roles } from '../db/schema'

/** What someone holds, whatever their status is. */
export interface Holdings {
  /** Holds the built-in Administrator role, which is more than every permission together. */
  administrator: boolean
  grants: Grants
}

export interface Managed {
  projects: ReadonlySet<number>
  people: ReadonlySet<number>
  /** Those of the managed projects. */
  clients: ReadonlySet<number>
}

export interface PersonActor extends Holdings {
  kind: 'person'
  id: number
  name: string
  /** Not archived and not waiting for approval. Without it there is not even base access. */
  active: boolean
  managed: Managed
}

/** Made only by systemActor() in system.ts. A class, so that nothing read from a request can pass for it. */
export class SystemActor {
  readonly kind = 'system'
  constructor(readonly name: string) {}
}

export type Actor = PersonActor | SystemActor

export const isSystem = (actor: Actor): actor is SystemActor => actor instanceof SystemActor

/** For records of who did something; null for the system. */
export const actorId = (actor: Actor): number | null => (isSystem(actor) ? null : actor.id)

export type RoleRow = typeof roles.$inferSelect

export interface PersonAccess extends Holdings {
  person: Pick<typeof people.$inferSelect, 'id' | 'name' | 'email' | 'status'>
  role: RoleRow
  /** As stored, if they have an effect or not. */
  extras: PermissionKey[]
}

/** Someone's role and extras, and what these give while the person is active. */
export async function readPersonAccess(db: Db | Tx, personId: number): Promise<PersonAccess | undefined> {
  const [row] = await db
    .select({ person: { id: people.id, name: people.name, email: people.email, status: people.status }, role: roles })
    .from(people)
    .innerJoin(roles, eq(roles.id, people.roleId))
    .where(eq(people.id, personId))
  if (!row) return undefined
  const stored = await db.select({ key: personExtras.permission }).from(personExtras).where(eq(personExtras.personId, personId))
  const extras = managerExtras.filter((extra) => stored.some(({ key }) => key === extra))
  return { ...row, extras, administrator: isAdministratorRole(row.role), grants: roleGrants(row.role, extras) }
}

/** The projects where the person is a member now, with the manager flag. */
export const managedProjectIds = (db: Db | Tx, personId: number) =>
  db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.personId, personId), eq(projectMembers.isManager, true), isNull(projectMembers.removedAt)))

/** The people assigned to a manager. */
export const managedPersonIds = (db: Db | Tx, managerId: number) =>
  db.select({ id: personManagers.personId }).from(personManagers).where(eq(personManagers.managerId, managerId))

const idsOf = (rows: { id: number }[]) => new Set(rows.map(({ id }) => id))

const none: Managed = { projects: new Set(), people: new Set(), clients: new Set() }

const hasManagedLevel = (grants: Grants) => grantedKeys(grants).some((key) => grants[key] === 'managed')

async function readManaged(db: Db | Tx, personId: number): Promise<Managed> {
  const managedProjects = await db
    .select({ id: projects.id, clientId: projects.clientId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.personId, personId), eq(projectMembers.isManager, true), isNull(projectMembers.removedAt)))
  return {
    projects: idsOf(managedProjects),
    people: idsOf(await managedPersonIds(db, personId)),
    clients: new Set(managedProjects.map(({ clientId }) => clientId)),
  }
}

/** The person as an actor. Someone who is not active, or gone, may do nothing. */
export async function loadActor(db: Db | Tx, personId: number): Promise<PersonActor> {
  const access = await readPersonAccess(db, personId)
  const base = { kind: 'person', id: personId, name: access?.person.name ?? '' } as const
  if (access?.person.status !== 'active') return { ...base, active: false, administrator: false, grants: {}, managed: none }
  const { administrator, grants } = access
  return { ...base, active: true, administrator, grants, managed: hasManagedLevel(grants) ? await readManaged(db, personId) : none }
}

/** The same actor as of now, for decisions inside a transaction. */
export async function currentActor(db: Db | Tx, actor: Actor): Promise<Actor> {
  return isSystem(actor) ? actor : loadActor(db, actor.id)
}

/** Whether the first holds everything the second does. */
export function holdsAll(have: Holdings, wanted: Holdings): boolean {
  if (have.administrator) return true
  if (wanted.administrator) return false
  return grantedKeys(wanted.grants).every((key) => reaches(have.grants[key], wanted.grants[key] ?? 'managed'))
}

/** Changes whenever the person may do something else, or on something else. */
export function accessFingerprint({ administrator, grants, managed }: PersonActor): string {
  const list = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b).join(',')
  const parts = [administrator, ...grantedKeys(grants).map((key) => `${key}:${grants[key]}`), list(managed.projects), list(managed.people)]
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}
