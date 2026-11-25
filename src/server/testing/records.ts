import { eq, type InferInsertModel } from 'drizzle-orm'
import { type BuiltInRole, type Grants, type PermissionKey, writeGrants } from '../../shared/permissions'
import type { Db } from '../db'
import {
  clients, expenseCategories, expenses, invoices, people, personExtras, personManagers, projectMembers, projects, projectTasks,
  roles, tasks, timeEntries,
} from '../db/schema'

let counter = 0
/** Unique within a test run, for names. */
const unique = (name: string) => `${name} ${++counter}`

function only<T>(rows: T[]): T {
  const [row] = rows
  if (row === undefined) throw new Error('Expected a row')
  return row
}

type Values<T extends { $inferInsert: object }> = Partial<T['$inferInsert']>

/** Makes records with sensible values; pass what matters to the test. */
export function makeRecords(db: Db) {
  const make = {
    async person(values: Values<typeof people> = {}) {
      const role = only(await db.select().from(roles).where(eq(roles.key, 'member')))
      const name = unique('Person')
      const email = `${name.replace(' ', '')}@jet.example`.toLowerCase()
      return only(
        await db.insert(people).values({ name, email, status: 'active', roleId: role.id, ...values }).returning(),
      )
    },
    async client(values: Values<typeof clients> = {}) {
      return only(await db.insert(clients).values({ name: unique('Client'), currency: 'USD', ...values }).returning())
    },
    async task(values: Values<typeof tasks> = {}) {
      return only(await db.insert(tasks).values({ name: unique('Task'), ...values }).returning())
    },
    async project(values: Values<typeof projects> & { clientId: number }) {
      return only(
        await db
          .insert(projects)
          .values({ name: unique('Project'), type: 'time_materials', rateMethod: 'project', rate: 10_000, ...values })
          .returning(),
      )
    },
    async projectTask(values: InferInsertModel<typeof projectTasks>) {
      return only(await db.insert(projectTasks).values(values).returning())
    },
    async projectMember(values: InferInsertModel<typeof projectMembers>) {
      return only(await db.insert(projectMembers).values(values).returning())
    },
    async timeEntry(values: Values<typeof timeEntries> & { personId: number; projectId: number; taskId: number }) {
      return only(
        await db
          .insert(timeEntries)
          .values({ spentOn: '2026-03-02', minutes: 60, billable: true, createdBy: values.personId, ...values })
          .returning(),
      )
    },
    async category(values: Values<typeof expenseCategories> = {}) {
      return only(await db.insert(expenseCategories).values({ name: unique('Category'), ...values }).returning())
    },
    async expense(values: Values<typeof expenses> & { personId: number; projectId: number; categoryId: number }) {
      return only(
        await db
          .insert(expenses)
          .values({
            spentOn: '2026-03-02', currency: 'USD', amount: 1000, billable: true, createdBy: values.personId, ...values,
          })
          .returning(),
      )
    },
    async invoice(values: Values<typeof invoices> & { clientId: number; createdBy: number }) {
      return only(
        await db
          .insert(invoices)
          .values({
            number: unique('TEST'), currency: 'USD', issuedOn: '2026-04-01', dueOn: '2026-05-01', ...values,
          })
          .returning(),
      )
    },
    /** A role made by people. */
    async role(grants: Grants = {}, values: Values<typeof roles> = {}) {
      return only(await db.insert(roles).values({ name: unique('Role'), permissions: writeGrants(grants), ...values }).returning())
    },
    async builtInRole(key: BuiltInRole) {
      return only(await db.select().from(roles).where(eq(roles.key, key)))
    },
    async extras(personId: number, ...keys: PermissionKey[]) {
      await db.insert(personExtras).values(keys.map((permission) => ({ personId, permission })))
    },
    async manages(managerId: number, personId: number) {
      await db.insert(personManagers).values({ managerId, personId })
    },
    /** A person, client, project and task that fit together. */
    async workplace() {
      const person = await make.person()
      const client = await make.client()
      const task = await make.task()
      const project = await make.project({ clientId: client.id })
      const projectTask = await make.projectTask({ projectId: project.id, taskId: task.id })
      const place = { personId: person.id, projectId: project.id, taskId: task.id }
      return { person, client, task, project, projectTask, place }
    },
  }
  return make
}

export type Make = ReturnType<typeof makeRecords>
