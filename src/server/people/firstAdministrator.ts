/** What the admin:create command does, apart from asking. */
import { eq } from 'drizzle-orm'
import { productName } from '../../shared/product'
import { endSessions } from '../auth/sessions'
import { type Db, runTransaction } from '../db'
import { people, personCredentials, roles } from '../db/schema'
import { StartupError } from '../errors'
import { hashPassword } from '../security/passwords'
import { passwordChangedText } from '../email/messages'
import { type EmailSender, sendEmail } from '../email/sender'
import { logActivity } from './activity'
import { activeAdministratorWithPassword, findPersonByEmail, getSettings, lockEmail, lockPerson } from './lookup'
import { storePassword } from './resets'

/** Refuses early, before anything is asked. Checked again when writing. */
export async function checkCanCreate(db: Db): Promise<void> {
  if (await activeAdministratorWithPassword(db)) {
    throw new StartupError(
      'There is an administrator already. Ask them for an invite, or set a new password with npm run admin:create -- --reset <email>.',
    )
  }
}

export async function checkEmailIsFree(db: Db, email: string): Promise<void> {
  if (await findPersonByEmail(db, email)) throw new StartupError(`This email already belongs to a person in ${productName}.`)
}

export async function createAdministrator(
  db: Db, { name, email, password }: { name: string; email: string; password: string }, now = new Date(),
): Promise<void> {
  await checkCanCreate(db)
  const passwordHash = await hashPassword(password)
  await runTransaction(db, async (tx) => {
    // Locking the role makes two commands at once take turns.
    const [role] = await tx.select().from(roles).where(eq(roles.key, 'administrator')).for('update')
    if (!role) throw new Error('The built-in role administrator is missing')
    await lockEmail(tx, email)
    await checkCanCreate(tx)
    await checkEmailIsFree(tx, email)
    const { timeZone } = await getSettings(tx)
    const [person] = await tx
      .insert(people)
      .values({ name, email, timeZone, status: 'active', roleId: role.id })
      .returning({ id: people.id })
    const personId = person?.id ?? 0
    await tx.insert(personCredentials).values({ personId, passwordHash, changedAt: now })
    await logActivity(tx, {
      actorId: null, action: 'created', personId, summary: `Created the first administrator ${name} (${email}) on the server`,
    })
  })
}

/** The active administrator with this email; anyone else is refused. */
export async function findAdministrator(db: Db, email: string) {
  const found = await findPersonByEmail(db, email)
  if (found?.person.status !== 'active' || found.roleKey !== 'administrator') {
    throw new StartupError('There is no active administrator with this email. Other people get a reset link from an administrator.')
  }
  return found.person
}

export async function resetAdministrator(db: Db, sender: EmailSender, email: string, password: string, now = new Date()): Promise<void> {
  const passwordHash = await hashPassword(password)
  const person = await runTransaction(db, async (tx) => {
    const { id } = await findAdministrator(tx, email)
    await lockPerson(tx, id)
    const found = await findAdministrator(tx, email)
    await storePassword(tx, id, passwordHash, now)
    await endSessions(tx, id)
    await logActivity(tx, {
      actorId: null, action: 'password_reset', personId: id, summary: `Set a new password for ${found.name} on the server`,
    })
    return found
  })
  await sendEmail(sender, { ...passwordChangedText(person.name), to: { name: person.name, email: person.email }, personId: person.id })
}
