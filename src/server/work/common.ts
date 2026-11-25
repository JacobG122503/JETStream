/** What the services of the daily work share: notes of changes, and locks on what they use. */
import { eq, inArray, sql } from 'drizzle-orm'
import { type Actor, actorId } from '../access/actor'
import type { Tx } from '../db'
import { activityLog, clients, labels, people, projects, tags } from '../db/schema'
import { ApiError, NotFoundError } from '../errors'

export interface Change {
  action: string
  type: string
  id: number | null
  summary: string
  changes?: Record<string, unknown>
}

/** Notes who changed what, in the transaction that does it. */
export async function logChange(tx: Tx, actor: Actor, { action, type, id, summary, changes = {} }: Change): Promise<void> {
  await tx.insert(activityLog).values({ actorId: actorId(actor), action, subjectType: type, subjectId: id, summary, changes })
}

/** Before and after of what differs. */
export function differences(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const found: Record<string, [unknown, unknown]> = {}
  for (const [key, value] of Object.entries(after)) {
    if (value !== undefined && JSON.stringify(before[key] ?? null) !== JSON.stringify(value ?? null)) found[key] = [before[key] ?? null, value]
  }
  return found
}

/** `use` lets others use it too; `change` waits for them, and they for it. Order: client, project, person. */
export type Hold = 'use' | 'change'
const strength = { use: 'share', change: 'update' } as const

export async function holdClient(tx: Tx, id: number, hold: Hold) {
  const [client] = await tx.select().from(clients).where(eq(clients.id, id)).for(strength[hold])
  if (!client) throw new NotFoundError(id)
  if (hold === 'use' && client.archivedAt !== null) throw new ApiError(409, 'client_archived', 'This client is archived.')
  return client
}

export async function holdProject(tx: Tx, id: number, hold: Hold) {
  const [project] = await tx.select().from(projects).where(eq(projects.id, id)).for(strength[hold])
  if (!project) throw new NotFoundError(id)
  if (hold === 'use' && project.archivedAt !== null) throw new ApiError(409, 'project_archived', 'This project is archived.')
  return project
}

export async function holdPerson(tx: Tx, id: number, hold: Hold) {
  const [person] = await tx.select().from(people).where(eq(people.id, id)).for(strength[hold])
  if (!person) throw new NotFoundError(id)
  if (hold === 'use' && person.status !== 'active') throw new ApiError(409, 'not_active', 'This person is not active.')
  return person
}

/** The ids of labels or tags with these names, ignoring case. Those that are new are made. */
export async function namedIds(tx: Tx, table: typeof labels | typeof tags, names: readonly string[]): Promise<number[]> {
  const wanted = [...new Map(names.map((name) => [name.toLowerCase(), name])).entries()]
  if (wanted.length === 0) return []
  await tx.insert(table).values(wanted.map(([, name]) => ({ name }))).onConflictDoNothing()
  const found = await tx.select({ id: table.id }).from(table).where(inArray(sql`lower(${table.name})`, wanted.map(([key]) => key)))
  return found.map(({ id }) => id)
}
