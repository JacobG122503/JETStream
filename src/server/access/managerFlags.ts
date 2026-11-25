/** The manager flag of project memberships. Whatever sets, restores or copies it does so here. */
import { and, eq, isNull } from 'drizzle-orm'
import type { Tx } from '../db'
import { projectMembers } from '../db/schema'
import { ApiError } from '../errors'
import { type Actor, isSystem, type PersonAccess } from './actor'
import { checkGrant, refuse, type Refusal } from './grants'

/** Whether the editor may let the person manage the project, or end that. Null when they may. */
export function checkManagerFlag(editor: Actor, target: PersonAccess, projectId: number): Refusal | null {
  return checkGrant(editor, {
    personId: target.person.id, before: target, after: target, changed: { projects: [projectId] }, onlyFlags: true,
  })
}

/** Writes the flag of a current membership. The caller has checked the grant rule. Says whether it changed. */
export async function writeManagerFlag(tx: Tx, personId: number, projectId: number, isManager: boolean): Promise<boolean> {
  const changed = await tx
    .update(projectMembers)
    .set({ isManager })
    .where(
      and(
        eq(projectMembers.personId, personId), eq(projectMembers.projectId, projectId), isNull(projectMembers.removedAt),
        eq(projectMembers.isManager, !isManager),
      ),
    )
    .returning({ id: projectMembers.id })
  return changed.length > 0
}

/**
 * Lets someone manage a project, or ends it. The caller has called `lockForAccessChange` for the
 * person, passes the actor it returned, and logs the change.
 */
export async function setManagerFlag(tx: Tx, editor: Actor, target: PersonAccess, projectId: number, isManager: boolean): Promise<boolean> {
  refuse(checkManagerFlag(editor, target, projectId))
  const [member] = await tx
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.personId, target.person.id), eq(projectMembers.projectId, projectId), isNull(projectMembers.removedAt)))
  if (!member) throw new ApiError(409, 'not_member', 'Only people on the project can manage it.')
  return writeManagerFlag(tx, target.person.id, projectId, isManager)
}

export interface Returned {
  /** The person manages the project again. */
  restored: boolean
  /** The flag was there, and is gone, because whoever assigned the person could not give it. */
  dropped: boolean
}

/**
 * Takes someone back onto a project they were on before, with what was kept. The manager flag comes
 * back only if the assigner could set it now.
 */
export async function returnMember(tx: Tx, assigner: Actor, target: PersonAccess, projectId: number): Promise<Returned> {
  const of = and(eq(projectMembers.personId, target.person.id), eq(projectMembers.projectId, projectId))
  const [member] = await tx.select().from(projectMembers).where(of).for('no key update')
  if (!member || member.removedAt === null) return { restored: false, dropped: false }
  const restored = member.isManager && (isSystem(assigner) || checkManagerFlag(assigner, target, projectId) === null)
  await tx.update(projectMembers).set({ removedAt: null, isManager: restored }).where(of)
  return { restored, dropped: member.isManager && !restored }
}
