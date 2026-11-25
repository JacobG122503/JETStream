// What is logged about unexpected errors: never what people typed.
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewLink } from '../../shared/api'
import type { Database } from '../db'
import { people, roles, signInAttempts } from '../db/schema'
import { describeError } from '../errors'
import { accounts, browser, goodPassword, signedIn, testApp } from '../testing/apiClient'
import { createTestDatabase } from '../testing/testDatabase'

let database: Database
let account: ReturnType<typeof accounts>
beforeAll(async () => {
  database = await createTestDatabase()
  account = accounts(database.db)
})
afterAll(() => database.close())

let log: string[]
beforeEach(async () => {
  await database.db.delete(signInAttempts)
  log = []
  for (const name of ['error', 'warn', 'log', 'info', 'debug'] as const) {
    vi.spyOn(console, name).mockImplementation((...parts: unknown[]) => {
      log.push(parts.map((part) => (part instanceof Error ? `${part.stack}${JSON.stringify(part)}` : String(part))).join(' '))
    })
  }
})

/** Until it is undone, every change to the table fails, with an error of the database that holds the values. */
async function failOn(table: string) {
  await database.db.execute(sql`
    create or replace function refuse() returns trigger as $$ begin
      raise exception 'refused %', new using errcode = '23505', detail = new::text, constraint = 'people_email_lower_key';
    end $$ language plpgsql`)
  await database.db.execute(sql.raw(`create trigger refuse before insert or update on ${table} for each row execute function refuse()`))
  return () => database.db.execute(sql.raw(`drop trigger refuse on ${table}`))
}

describe('a database error', () => {
  const password = 'Sensitive pass phrase 77'
  const email = 'sensitive.address@client.example'

  type Client = ReturnType<typeof browser>

  async function attempt(table: string, work: (client: Client, office: Client) => Promise<{ status: number; text: string }>) {
    const admin = await account('administrator')
    const app = testApp({ db: database.db })
    const office = await signedIn(app, admin.email)
    const undo = await failOn(table)
    const response = await work(browser(app), office).finally(undo)
    expect(response.status).toBe(500)
    expect(response.text).toBe('{"error":{"code":"internal_error","message":"Something went wrong"}}')
    const text = log.join('\n')
    expect(text).toContain('code 23505')
    expect(text).toContain('people_email_lower_key')
    expect(text).toMatch(/\n {4}at /)
    for (const secret of [password, email, admin.email, goodPassword, 'duplicate key', 'already exists', 'scrypt']) {
      expect(text).not.toContain(secret)
    }
    return text
  }

  it('in sign-in', async () => {
    expect(await attempt('sign_in_attempts', (client) => client.signIn(email, password))).toContain('POST /session/sign-in')
    const person = await account()
    expect(await attempt('sessions', (client) => client.signIn(person.email, goodPassword))).not.toContain(person.email)
  })

  const signUp = (client: Client) => client.post('/sign-up', { name: 'N', email, password, timeZone: 'UTC' })
  it.each(['sign_in_attempts', 'people', 'person_credentials'])('of %s in sign-up', async (table) => {
    await attempt(table, signUp)
  })

  it.each(['invites', 'activity_log'])('of %s in inviting', async (table) => {
    const roleId = (await database.db.select().from(roles))[0]?.id
    await attempt(table, (_client, office) => office.post('/invites', { name: 'N', email, roleId }))
  })

  it('in using an invite', async () => {
    let token = ''
    const text = await attempt('activity_log', async (client, office) => {
      await database.db.execute(sql`alter table activity_log disable trigger refuse`)
      const roleId = (await database.db.select().from(roles))[0]?.id
      const { link } = (await office.post('/invites', { name: 'N', email, roleId })).body as NewLink
      await database.db.execute(sql`alter table activity_log enable trigger refuse`)
      token = link.split('#')[1] ?? ''
      return client.post('/invite/accept', { token, name: 'N', password, timeZone: 'UTC' })
    })
    expect(token).toHaveLength(43)
    expect(text).not.toContain(token)
  })

  it('in using a reset link', async () => {
    const person = await account()
    let token = ''
    const text = await attempt('activity_log', async (client, office) => {
      await database.db.execute(sql`alter table activity_log disable trigger refuse`)
      const { link } = (await office.post(`/people/${person.id}/reset-link`)).body as NewLink
      await database.db.execute(sql`alter table activity_log enable trigger refuse`)
      token = link.split('#')[1] ?? ''
      return client.post('/reset-password/use', { token, password })
    })
    expect(token).toHaveLength(43)
    expect(text).not.toContain(token)
    expect(text).not.toContain(person.email)
  })

  it('in asking for help, changing the password and the profile', async () => {
    await attempt('sign_in_attempts', (client) => client.post('/forgot-password', { email }))
    for (const table of ['person_credentials', 'sessions']) {
      await attempt(table, (_client, office) => office.post('/account/password', { currentPassword: goodPassword, newPassword: password }))
    }
    await attempt('people', (_client, office) => office.put('/account/profile', { name: email, timeZone: 'UTC', version: 1 }))
  })
})

describe('a real duplicate key', () => {
  it('names the constraint only', async () => {
    const person = await account()
    const error: unknown = await Promise.resolve(
      database.db.insert(people).values({ name: 'x', email: person.email, status: 'active', roleId: person.roleId }),
    ).catch((reason: unknown) => reason)
    expect(String(error) + String((error as Error).cause)).toContain(person.email)
    const text = describeError(error)
    expect(text).toContain('code 23505, constraint people_email_lower_key')
    expect(text).not.toContain(person.email)
  })
})

it('is as short as that also for strange errors', () => {
  const secret = 'hunter2'
  const lines = new Error(`first\n    at ${secret} line\n${secret}`)
  const renamed = Object.assign(new Error('x'), { name: secret + ' name', code: `${secret} code` })
  const changed = new Error('before')
  changed.message = secret
  changed.stack = `Error: before ${secret}\n    at somewhere`
  const deep = new Error('a', { cause: new TypeError(secret, { cause: { secret } }) })
  for (const error of [lines, renamed, changed, deep, secret, { secret }, null, undefined]) {
    expect(describeError(error)).not.toContain(secret)
  }
  expect(describeError(deep)).toContain('caused by TypeError')
})

it('is nothing for what goes as expected', async () => {
  const admin = await account('administrator')
  const app = testApp({ db: database.db })
  const office = await signedIn(app, admin.email)
  await browser(app).signIn(admin.email, 'wrong')
  const { link } = (await office.post('/invites', { name: 'N', email: 'fine@client.example', roleId: admin.roleId })).body as NewLink
  await browser(app).post('/invite/check', { token: link.split('#')[1] })
  await browser(app).post('/invite/check', { token: 'x' })
  expect(log).toEqual([])
})
