/** Client companies and projects of a person. */
import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { AssignmentClient } from '../../shared/api'
import { type Db, runTransaction, type Tx } from '../db'
import { clients, personClients, projectMembers, projects } from '../db/schema'
import { ApiError } from '../errors'
import { logActivity } from './activity'
import { lockPerson } from './lookup'
import { isCurrentMembership } from './membership'

export interface Assignments {
  clientIds: number[]
  projectIds: number[]
}

const ids = (rows: { id: number }[]) => new Set(rows.map(({ id }) => id))

async function currentOf(db: Db | Tx, personId: number) {
  const memberships = await db
    .select({ id: projects.id, clientId: projects.clientId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.personId, personId), isCurrentMembership()))
  const own = await db.select({ id: personClients.clientId }).from(personClients).where(eq(personClients.personId, personId))
  // Being on a project means being assigned to its client.
  return { projectIds: ids(memberships), clientIds: new Set([...ids(own), ...memberships.map(({ clientId }) => clientId)]) }
}

type Current = Awaited<ReturnType<typeof currentOf>>

/** Changes whenever the assignments do, whoever changes them. */
function stateOf({ clientIds, projectIds }: Current): string {
  const list = (set: Set<number>) => [...set].sort((a, b) => a - b).join(',')
  return createHash('sha256').update(`${list(clientIds)}|${list(projectIds)}`).digest('hex').slice(0, 32)
}

async function catalogue(db: Db | Tx) {
  const order = (name: typeof clients.name | typeof projects.name) => asc(sql`lower(${name})`)
  return {
    clients: await db
      .select({ id: clients.id, name: clients.name, archivedAt: clients.archivedAt })
      .from(clients)
      .orderBy(order(clients.name), clients.id),
    projects: await db
      .select({ id: projects.id, clientId: projects.clientId, name: projects.name, code: projects.code, archivedAt: projects.archivedAt })
      .from(projects)
      .orderBy(order(projects.name), projects.id),
  }
}

/**
 * Clients and projects with what is assigned. Archived ones only where they are assigned.
 * Without a person: what can be chosen for a new one.
 */
export async function readAssignments(db: Db | Tx, personId?: number): Promise<{ clients: AssignmentClient[]; state: string }> {
  const current = personId === undefined ? { clientIds: new Set<number>(), projectIds: new Set<number>() } : await currentOf(db, personId)
  const all = await catalogue(db)
  const list = all.clients.map(({ id, name, archivedAt }) => ({
    id,
    name,
    archived: archivedAt !== null,
    assigned: current.clientIds.has(id),
    projects: all.projects
      .filter((project) => project.clientId === id)
      .map((project) => ({
        id: project.id,
        name: project.name,
        code: project.code,
        archived: project.archivedAt !== null || archivedAt !== null,
        assigned: current.projectIds.has(project.id),
      }))
      .filter((project) => !project.archived || project.assigned),
  }))
  return { clients: list.filter((client) => !client.archived || client.assigned), state: stateOf(current) }
}

/** Splits what was chosen into what can be assigned and what cannot any more. Unknown ids are refused. */
async function usable(db: Db | Tx, { clientIds, projectIds }: Assignments) {
  const chosenProjects = projectIds.length === 0 ? [] : await db
    .select({ id: projects.id, clientId: projects.clientId, archivedAt: projects.archivedAt, clientArchivedAt: clients.archivedAt })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(inArray(projects.id, projectIds))
  const chosenClients = clientIds.length === 0 ? [] : await db
    .select({ id: clients.id, archivedAt: clients.archivedAt })
    .from(clients)
    .where(inArray(clients.id, clientIds))
  if (chosenProjects.length < projectIds.length || chosenClients.length < clientIds.length) {
    throw new ApiError(400, 'invalid_input', 'A chosen client or project does not exist.')
  }
  const goodProjects = chosenProjects.filter(({ archivedAt, clientArchivedAt }) => archivedAt === null && clientArchivedAt === null)
  const goodClients = chosenClients.filter(({ archivedAt }) => archivedAt === null)
  const good = {
    projectIds: ids(goodProjects),
    clientIds: new Set([...ids(goodClients), ...goodProjects.map(({ clientId }) => clientId)]),
  }
  return {
    good,
    archived: {
      projectIds: projectIds.filter((id) => !good.projectIds.has(id)),
      clientIds: clientIds.filter((id) => !good.clientIds.has(id)),
    },
  }
}

/** Checks choices for a new person and leaves out what is archived. */
export async function checkAssignments(db: Db | Tx, chosen: Assignments): Promise<Assignments> {
  const { good } = await usable(db, chosen)
  return { clientIds: [...good.clientIds], projectIds: [...good.projectIds] }
}

/** Adds assignments, leaving out what is archived. What was removed before comes back with its rate and manager flag. */
export async function addAssignments(tx: Tx, personId: number, chosen: Assignments): Promise<void> {
  const { good } = await usable(tx, chosen)
  await add(tx, personId, good)
}

async function add(tx: Tx, personId: number, { clientIds, projectIds }: Current): Promise<void> {
  if (clientIds.size > 0) {
    await tx
      .insert(personClients)
      .values([...clientIds].map((clientId) => ({ personId, clientId })))
      .onConflictDoNothing()
  }
  for (const projectId of [...projectIds].sort((a, b) => a - b)) {
    await tx
      .insert(projectMembers)
      .values({ projectId, personId })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.personId],
        set: { removedAt: null, version: sql`${projectMembers.version} + 1`, updatedAt: sql`now()` },
        setWhere: sql`${projectMembers.removedAt} is not null`,
      })
  }
}

export interface AssignmentChange extends Assignments {
  personId: number
  /** As read by the caller. */
  state: string
  actorId: number
  now: Date
}

/**
 * Makes the person's assignments to current clients and projects what was chosen. Those to archived
 * ones stay, except that removing a client removes all of its projects.
 */
export async function saveAssignments(db: Db, { personId, clientIds, projectIds, state, actorId, now }: AssignmentChange): Promise<void> {
  await runTransaction(db, async (tx) => {
    const person = await lockPerson(tx, personId)
    if (!person) throw new ApiError(404, 'not_found', 'Not found')
    if (person.status !== 'active') throw new ApiError(409, 'not_active', 'Only active people can be assigned.')
    const current = await currentOf(tx, personId)
    const stale = new ApiError(409, 'stale', 'Someone else changed this in the meantime. Reload to see the change.')
    if (stateOf(current) !== state) throw stale
    const { good, archived } = await usable(tx, { clientIds, projectIds })
    // Archived since the caller read the list: what is assigned stays, the rest cannot be chosen.
    if (archived.clientIds.some((id) => !current.clientIds.has(id)) || archived.projectIds.some((id) => !current.projectIds.has(id))) {
      throw stale
    }
    const all = await catalogue(tx)
    const archivedClients = ids(all.clients.filter(({ archivedAt }) => archivedAt !== null))
    const lostClients = [...current.clientIds].filter((id) => !good.clientIds.has(id) && !archivedClients.has(id))
    const lostProjects = all.projects.filter(
      ({ id, clientId, archivedAt }) =>
        current.projectIds.has(id) &&
        (lostClients.includes(clientId) ||
          (archivedAt === null && !archivedClients.has(clientId) && !good.projectIds.has(id))),
    )
    if (lostProjects.length > 0) {
      await tx
        .update(projectMembers)
        .set({ removedAt: now })
        .where(
          and(
            eq(projectMembers.personId, personId),
            inArray(projectMembers.projectId, lostProjects.map(({ id }) => id)),
            isCurrentMembership(),
          ),
        )
    }
    if (lostClients.length > 0) {
      await tx.delete(personClients).where(and(eq(personClients.personId, personId), inArray(personClients.clientId, lostClients)))
    }
    await add(tx, personId, good)
    const names = (list: { id: number; name: string }[], chosen: (id: number) => boolean) =>
      list.filter(({ id }) => chosen(id)).map(({ name }) => name)
    const changes = {
      clientsAdded: names(all.clients, (id) => good.clientIds.has(id) && !current.clientIds.has(id)),
      clientsRemoved: names(all.clients, (id) => lostClients.includes(id)),
      projectsAdded: names(all.projects, (id) => good.projectIds.has(id) && !current.projectIds.has(id)),
      projectsRemoved: lostProjects.map(({ name }) => name),
    }
    if (Object.values(changes).some((list) => list.length > 0)) {
      await logActivity(tx, {
        actorId, action: 'assigned', personId, summary: `Changed the client and project assignments of ${person.name}`, changes,
      })
    }
  })
}
