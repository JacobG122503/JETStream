/** What administrators see about people. */
import { asc, eq, sql } from 'drizzle-orm'
import type { PeopleOptions, PersonDetails, PersonRow } from '../../shared/api'
import type { Db } from '../db'
import { people, personCredentials, roles } from '../db/schema'
import { ApiError } from '../errors'
import { readAssignments } from './assignments'
import { openInviteEmails } from './invites'
import { getSettings } from './lookup'

const selectPeople = (db: Db) =>
  db
    .select({ person: people, role: roles.name, credential: personCredentials.personId })
    .from(people)
    .innerJoin(roles, eq(roles.id, people.roleId))
    .leftJoin(personCredentials, eq(personCredentials.personId, people.id))

function toRow(invited: Set<string>) {
  return ({ person, role, credential }: Awaited<ReturnType<typeof selectPeople>>[number]): PersonRow => ({
    id: person.id,
    name: person.name,
    email: person.email,
    role,
    status: person.status,
    signIn: credential !== null ? 'password' : invited.has(person.email.toLowerCase()) ? 'invited' : 'none',
    photoId: person.photoFileId,
  })
}

export async function listPeople(db: Db, now: Date): Promise<PersonRow[]> {
  const rows = await selectPeople(db).orderBy(asc(sql`lower(${people.name})`), asc(people.id))
  return rows.map(toRow(await openInviteEmails(db, now)))
}

export async function readPerson(db: Db, id: number, now: Date): Promise<PersonDetails> {
  const [row] = await selectPeople(db).where(eq(people.id, id))
  if (!row) throw new ApiError(404, 'not_found', 'Not found')
  return {
    ...toRow(await openInviteEmails(db, now))(row),
    timeZone: row.person.timeZone ?? (await getSettings(db)).timeZone,
    ...(await readAssignments(db, id)),
  }
}

export async function readOptions(db: Db): Promise<PeopleOptions> {
  const rows = await db.select().from(roles).where(eq(roles.builtIn, true)).orderBy(asc(roles.id))
  return {
    roles: rows.flatMap(({ id, key, name }) => (key === null ? [] : [{ id, key, name }])),
    clients: (await readAssignments(db)).clients,
  }
}
