/** What people see about people. */
import { asc, eq, sql } from 'drizzle-orm'
import type { PeopleOptions, PersonDetails, PersonRow } from '../../shared/api'
import type { Actor } from '../access/actor'
import { readPersonAccess } from '../access/actor'
import { holds, requirePermission, requireRecord } from '../access/decisions'
import { filterFor } from '../access/filters'
import { checkOutranks } from '../access/grants'
import { mayGiveRole } from '../access/links'
import type { Db } from '../db'
import { people, personCredentials, roles } from '../db/schema'
import { NotFoundError } from '../errors'
import { readAssignments } from './assignments'
import { openInviteEmails } from './invites'
import { getSettings } from './lookup'

const selectPeople = (db: Db) =>
  db
    .select({ person: people, role: roles.name, credential: personCredentials.personId })
    .from(people)
    .innerJoin(roles, eq(roles.id, people.roleId))
    .leftJoin(personCredentials, eq(personCredentials.personId, people.id))

/** `invited` only for those who manage people: how someone signs in is nobody else's business. */
function toRow(invited: Set<string> | null) {
  return ({ person, role, credential }: Awaited<ReturnType<typeof selectPeople>>[number]): PersonRow => ({
    id: person.id,
    name: person.name,
    email: person.email,
    role,
    status: person.status,
    photoId: person.photoFileId,
    ...(invited && { signIn: credential !== null ? 'password' : invited.has(person.email.toLowerCase()) ? 'invited' : 'none' }),
  })
}

const invitedFor = async (db: Db, actor: Actor, now: Date) => (holds(actor, 'people.manage') ? openInviteEmails(db, now) : null)

export async function listPeople(db: Db, actor: Actor, now: Date): Promise<PersonRow[]> {
  requirePermission(actor, 'people.view')
  const rows = await selectPeople(db)
    .where(filterFor(db, actor, 'people.view', 'person'))
    .orderBy(asc(sql`lower(${people.name})`), asc(people.id))
  return rows.map(toRow(await invitedFor(db, actor, now)))
}

export async function readPerson(db: Db, actor: Actor, id: number, now: Date): Promise<PersonDetails> {
  requireRecord(actor, { view: 'people.view' }, { type: 'person', personId: id }, id)
  const [row] = await selectPeople(db).where(eq(people.id, id))
  const access = await readPersonAccess(db, id)
  if (!row || !access) throw new NotFoundError(id)
  return {
    ...toRow(await invitedFor(db, actor, now))(row),
    timeZone: row.person.timeZone ?? (await getSettings(db)).timeZone,
    ...(holds(actor, 'people.manage') && {
      ...(await readAssignments(db, id)),
      accountRefusal: checkOutranks(actor, access)?.message ?? null,
    }),
  }
}

/** What can be chosen for someone who is approved or invited. */
export async function readOptions(db: Db, actor: Actor): Promise<PeopleOptions> {
  requirePermission(actor, 'people.manage')
  const rows = await db.select().from(roles).orderBy(asc(sql`not ${roles.builtIn}`), asc(sql`case when ${roles.builtIn} then ${roles.id} end`), asc(sql`lower(${roles.name})`))
  return {
    roles: rows.map((role) => ({ id: role.id, key: role.key, name: role.name, allowed: mayGiveRole(actor, role) })),
    clients: (await readAssignments(db)).clients,
  }
}
