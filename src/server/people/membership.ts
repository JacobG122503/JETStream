/** Who works on what. Every feature asks here, so that a removed assignment counts nowhere. */
import { and, eq, isNull, type SQL } from 'drizzle-orm'
import type { Db, Tx } from '../db'
import { projectMembers } from '../db/schema'

/** Condition on rows of project_members: the person is on the project now. */
export const isCurrentMembership = (): SQL => isNull(projectMembers.removedAt)

/** The person's membership of a project, or undefined for someone who is not on it or was taken off it. */
export async function currentMembership(db: Db | Tx, personId: number, projectId: number) {
  const [member] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.personId, personId), eq(projectMembers.projectId, projectId), isCurrentMembership()))
  return member
}

export async function isProjectMember(db: Db | Tx, personId: number, projectId: number): Promise<boolean> {
  return (await currentMembership(db, personId, projectId)) !== undefined
}
