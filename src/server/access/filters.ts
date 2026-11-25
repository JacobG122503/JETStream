/** The rules of decisions.ts as conditions for queries, so that pages and totals of lists are right. */
import { and, eq, exists, inArray, isNotNull, isNull, ne, not, notExists, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { PermissionKey } from '../../shared/permissions'
import type { Db, Tx } from '../db'
import {
  assignments, clients, estimateLines, estimates, expenses, invoiceLines, invoices, people, projects, timeEntries,
  timeOffRequests,
} from '../db/schema'
import { type Actor, isSystem, managedPersonIds, managedProjectIds, type PersonActor } from './actor'
import { notForOwn, type RecordType } from './decisions'

const everything = sql`true`
const nothing = sql`false`
const both = (a: SQL | undefined, b: SQL | undefined): SQL => and(a, b) ?? everything
const either = (...conditions: (SQL | undefined)[]): SQL => or(...conditions) ?? nothing

/** The column with the person a record belongs to. */
const ownerColumn = {
  person: people.id,
  timeEntry: timeEntries.personId,
  expense: expenses.personId,
  receipt: expenses.personId,
  assignment: assignments.personId,
  timeOffRequest: timeOffRequests.personId,
} as const

const hasOwner = (type: RecordType): type is keyof typeof ownerColumn => type in ownerColumn

export interface FilterOptions {
  /** Also the person's own records, whatever they hold. */
  orOwner?: boolean
}

/**
 * Condition on a query over the table of the record type: the records for which the actor holds the
 * permission. For receipts the query joins expenses with their receipts.
 */
export function filterFor(db: Db | Tx, actor: Actor, permission: PermissionKey, type: RecordType, { orOwner = false }: FilterOptions = {}): SQL {
  if (isSystem(actor)) return everything
  const held = heldFor(db, actor, permission, type)
  return orOwner && actor.active && hasOwner(type) ? either(held, eq(ownerColumn[type], actor.id)) : held
}

function heldFor(db: Db | Tx, actor: PersonActor, permission: PermissionKey, type: RecordType): SQL {
  const level = actor.grants[permission]
  if (level === undefined) return nothing
  if (level === 'all') return everything
  const managed = managedFilter(db, actor, type)
  return notForOwn.includes(permission) && hasOwner(type) ? both(managed, ne(ownerColumn[type], actor.id)) : managed
}

function managedFilter(db: Db | Tx, actor: PersonActor, type: RecordType): SQL {
  const managedProjects = managedProjectIds(db, actor.id)
  const managedPeople = managedPersonIds(db, actor.id)
  switch (type) {
    case 'project':
      return inArray(projects.id, managedProjects)
    case 'client': {
      const own = alias(projects, 'own_projects')
      return inArray(clients.id, db.select({ id: own.clientId }).from(own).where(inArray(own.id, managedProjects)))
    }
    case 'person':
      return inArray(people.id, managedPeople)
    case 'timeOffRequest':
      return inArray(timeOffRequests.personId, managedPeople)
    case 'timeEntry':
      return either(inArray(timeEntries.projectId, managedProjects), inArray(timeEntries.personId, managedPeople))
    case 'expense':
    case 'receipt':
      return either(inArray(expenses.projectId, managedProjects), inArray(expenses.personId, managedPeople))
    case 'assignment':
      return either(inArray(assignments.projectId, managedProjects), inArray(assignments.personId, managedPeople))
    case 'invoice': {
      const ofInvoice = and(eq(invoiceLines.invoiceId, invoices.id), isNotNull(invoiceLines.projectId))
      const lines = (condition: SQL | undefined) => db.select({ one: sql`1` }).from(invoiceLines).where(condition)
      return either(
        both(exists(lines(ofInvoice)), notExists(lines(and(ofInvoice, not(inArray(invoiceLines.projectId, managedProjects)))))),
        both(notExists(lines(ofInvoice)), eq(invoices.createdBy, actor.id)),
      )
    }
    case 'estimate': {
      const ofEstimate = and(eq(estimateLines.estimateId, estimates.id), isNotNull(estimateLines.projectId))
      const unmanaged = and(ofEstimate, not(inArray(estimateLines.projectId, managedProjects)))
      const lines = (condition: SQL | undefined) => db.select({ one: sql`1` }).from(estimateLines).where(condition)
      return either(
        both(
          either(isNotNull(estimates.projectId), exists(lines(ofEstimate))),
          both(
            either(isNull(estimates.projectId), inArray(estimates.projectId, managedProjects)),
            notExists(lines(unmanaged)),
          ),
        ),
        both(
          both(isNull(estimates.projectId), notExists(lines(ofEstimate))),
          eq(estimates.createdBy, actor.id),
        ),
      )
    }
  }
}
