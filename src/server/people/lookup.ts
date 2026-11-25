import { eq, sql } from 'drizzle-orm'
import { administratorsWithPassword } from '../access/grants'
import type { Db, Tx } from '../db'
import { companySettings, people, personCredentials, roles } from '../db/schema'
import { ApiError } from '../errors'
import { lockKey } from '../auth/limits'

/** The person with this email, in lower case, and the stored password if there is one. */
export async function findPersonByEmail(db: Db | Tx, email: string) {
  const [row] = await db
    .select({
      person: people, passwordHash: personCredentials.passwordHash, passwordVersion: personCredentials.version, roleKey: roles.key,
    })
    .from(people)
    .innerJoin(roles, eq(roles.id, people.roleId))
    .leftJoin(personCredentials, eq(personCredentials.personId, people.id))
    .where(eq(sql`lower(${people.email})`, email))
  return row
}

/** Who wants to use an email for a new person or invite takes turns, so that only one gets it. */
export const lockEmail = (tx: Tx, email: string) => lockKey(tx, `email|${email}`)

/** A person, locked until the transaction ends, so that decisions about them take turns. */
export async function lockPerson(tx: Tx, id: number) {
  const [person] = await tx.select().from(people).where(eq(people.id, id)).for('update')
  return person
}

/** Which password the person has, as a number that a new one changes. */
export async function passwordVersion(db: Db | Tx, personId: number): Promise<number | undefined> {
  const [row] = await db
    .select({ version: personCredentials.version })
    .from(personCredentials)
    .where(eq(personCredentials.personId, personId))
  return row?.version
}

export async function hasPassword(db: Db | Tx, personId: number): Promise<boolean> {
  const rows = await db.select({ id: personCredentials.personId }).from(personCredentials).where(eq(personCredentials.personId, personId))
  return rows.length > 0
}

export async function getSettings(db: Db | Tx) {
  const [settings] = await db.select().from(companySettings)
  if (!settings) throw new Error('The company settings are missing')
  return settings
}

export async function builtInRole(db: Db | Tx, key: 'administrator' | 'manager' | 'member') {
  const [role] = await db.select().from(roles).where(eq(roles.key, key))
  if (!role) throw new Error(`The built-in role ${key} is missing`)
  return role
}

/** A role that can be given. Whether the actor may give it is another question. */
export async function requireRole(db: Db | Tx, id: number) {
  const [role] = await db.select().from(roles).where(eq(roles.id, id))
  if (!role) throw new ApiError(400, 'invalid_input', 'Choose a role.', { fields: { roleId: 'Choose a role.' } })
  return role
}

export async function activeAdministratorWithPassword(db: Db | Tx): Promise<boolean> {
  return (await administratorsWithPassword(db).limit(1)).length > 0
}

/** Sign-up needs someone who can approve. */
export async function isSignUpOpen(db: Db | Tx): Promise<boolean> {
  return (await getSettings(db)).signUpEnabled && (await activeAdministratorWithPassword(db))
}
