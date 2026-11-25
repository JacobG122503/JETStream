/**
 * The one place that answers "may this person do this to this record". Pure: everything it needs is
 * in the actor and the record. filters.ts says the same as conditions for lists; a test compares them.
 */
import { type Level, type PermissionKey, reaches } from '../../shared/permissions'
import { ApiError, NotFoundError } from '../errors'
import { type Actor, isSystem, type PersonActor } from './actor'

/** What has to be known about a record to decide. */
export type RecordFacts =
  | { type: 'project'; projectId: number }
  | { type: 'client'; clientId: number }
  | { type: 'person'; personId: number }
  | { type: 'timeEntry'; personId: number; projectId: number }
  | { type: 'expense'; personId: number; projectId: number }
  | { type: 'receipt'; personId: number; projectId: number }
  /** The projects of its lines. */
  | { type: 'invoice'; projectIds: readonly number[]; createdBy: number }
  /** The project it is linked to, and those of its lines. */
  | { type: 'estimate'; projectIds: readonly number[]; createdBy: number }
  /** Null for a placeholder. */
  | { type: 'assignment'; personId: number | null; projectId: number }
  | { type: 'timeOffRequest'; personId: number }

export type RecordType = RecordFacts['type']

/** What someone may not do to their own records unless they hold it at `all`. */
export const notForOwn: readonly PermissionKey[] = ['time.approve', 'timeoff.approve']

/** Whether the permission is held at all, at this level or a higher one. */
export function holds(actor: Actor, permission: PermissionKey, level: Level = 'managed'): boolean {
  return isSystem(actor) || reaches(actor.grants[permission], level)
}

export const isAdministrator = (actor: Actor): boolean => isSystem(actor) || actor.administrator

/** Whether the record is the person's own, which base access covers. */
export function owns(actor: Actor, record: RecordFacts): boolean {
  if (isSystem(actor) || !actor.active) return false
  return 'personId' in record && record.personId === actor.id
}

/** Whether the permission is held for this record. Says nothing about base access; see `owns`. */
export function can(actor: Actor, permission: PermissionKey, record: RecordFacts): boolean {
  if (isSystem(actor)) return true
  const level = actor.grants[permission]
  if (level === undefined) return false
  if (level === 'all') return true
  if (notForOwn.includes(permission) && owns(actor, record)) return false
  return isManaged(actor, record)
}

/** Whether the record is covered at the managed level. */
export function isManaged({ id, managed }: PersonActor, record: RecordFacts): boolean {
  const { projects, people, clients } = managed
  switch (record.type) {
    case 'project':
      return projects.has(record.projectId)
    case 'client':
      return clients.has(record.clientId)
    case 'person':
    case 'timeOffRequest':
      return people.has(record.personId)
    case 'timeEntry':
    case 'expense':
    case 'receipt':
    case 'assignment':
      return projects.has(record.projectId) || (record.personId !== null && people.has(record.personId))
    case 'invoice':
    case 'estimate':
      return record.projectIds.length > 0
        ? record.projectIds.every((projectId) => projects.has(projectId))
        : record.createdBy === id
  }
}

/** Whose own data a service works on that is for oneself only. */
export function ownId(actor: Actor): number {
  if (isSystem(actor) || !actor.active) throw forbidden()
  return actor.id
}

export const forbidden = () => new ApiError(403, 'forbidden', 'You do not have access to this')

/** Refuses someone who does not hold the permission at all, or not at this level. */
export function requirePermission(actor: Actor, permission: PermissionKey, level: Level = 'managed'): void {
  if (!holds(actor, permission, level)) throw forbidden()
}

export function requireAdministrator(actor: Actor): void {
  if (!isAdministrator(actor)) throw forbidden()
}

export interface Needed {
  /** What it takes to see the record. */
  view: PermissionKey
  /** What it takes to do what is asked, if that is more. */
  action?: PermissionKey
  /** Whether people may do it to their own records, whatever they hold. */
  orOwner?: boolean
}

/**
 * Refuses in this order: the permission is not held at all (forbidden), the record may not be seen
 * (not found, as if it did not exist), the action is not allowed (forbidden).
 */
export function requireRecord(actor: Actor, { view, action, orOwner = false }: Needed, record: RecordFacts | undefined, id = 0): void {
  if (!orOwner) {
    requirePermission(actor, view)
    if (action) requirePermission(actor, action)
  }
  const own = orOwner && record !== undefined && owns(actor, record)
  if (!record || !(own || can(actor, view, record))) throw new NotFoundError(id)
  if (action && !own && !can(actor, action, record)) throw forbidden()
}
