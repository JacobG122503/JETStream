import { eq } from 'drizzle-orm'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../db'
import { applyMigrations } from '../db/migrations'
import { activityLog, people, personCredentials, roles, sessions } from '../db/schema'
import { captureSender } from '../email/sender'
import { prepareData } from '../server'
import { accounts, browser, signedIn, testApp } from '../testing/apiClient'
import { makeRecords } from '../testing/records'
import { startServerProcess } from '../testing/serverProcess'
import { createTempDir, createTestDatabase } from '../testing/testDatabase'
import { createAdministrator, resetAdministrator } from './firstAdministrator'

const password = 'a good password'

describe('the first administrator', () => {
  let database: Database
  beforeAll(async () => {
    database = await createTestDatabase()
  })
  afterAll(() => database.close())

  it('is not made by migrations or a start', async () => {
    expect(await database.db.select().from(people)).toEqual([])
    expect((await prepareData({ mode: 'production' }, database)).join()).toMatch(/administer JETStream yet\..*npm run admin:create/)
    expect(await database.db.select().from(people)).toEqual([])
  })

  it('is made once, also by two commands at the same time, and never over someone else', async () => {
    const taken = await makeRecords(database.db).person()
    const input = (email: string) => ({ name: 'Ada Admin', email, password })
    await expect(createAdministrator(database.db, input(taken.email))).rejects.toThrow('already belongs to a person in JETStream')
    const results = await Promise.allSettled(['a', 'b'].map((name) => createAdministrator(database.db, input(`${name}@jet.example`))))
    expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected'])
    const made = await database.db.select({ person: people, role: roles.key }).from(people)
      .innerJoin(roles, eq(roles.id, people.roleId)).where(eq(people.name, 'Ada Admin'))
    expect(made).toMatchObject([{ role: 'administrator', person: { status: 'active' } }])
    await expect(createAdministrator(database.db, input('c@jet.example'))).rejects.toThrow('administrator already')
    const office = await signedIn(testApp({ db: database.db }), made[0]?.person.email ?? '', password)
    expect((await office.get('/people')).status).toBe(200)
    expect((await prepareData({ mode: 'production' }, database)).join()).not.toContain('npm run admin:create')
  })

  it('gets a new password with --reset, which ends the sessions; nobody else does', async () => {
    const account = accounts(database.db)
    const admin = await account('administrator')
    const app = testApp({ db: database.db })
    const office = await signedIn(app, admin.email)
    const sender = captureSender(database.db)
    for (const person of [await account('manager'), await account('administrator', { status: 'archived' })]) {
      await expect(resetAdministrator(database.db, sender, person.email, password)).rejects.toThrow('no active administrator')
    }
    await expect(resetAdministrator(database.db, sender, 'ghost@jet.example', password)).rejects.toThrow('no active administrator')
    await resetAdministrator(database.db, sender, admin.email, password)
    expect((await office.get('/account')).status).toBe(401)
    expect((await browser(app).signIn(admin.email, password)).status).toBe(200)
    expect(await database.db.select().from(sessions).where(eq(sessions.personId, admin.id))).toHaveLength(1)
    const log = await database.db.select().from(activityLog).where(eq(activityLog.subjectId, admin.id))
    expect(log).toMatchObject([{ action: 'password_reset', actorId: null }])
    expect(JSON.stringify(log)).not.toContain(password)
  })
})

describe('npm run admin:create', { timeout: 30_000 }, () => {
  async function command(args: string[], { input, ...settings }: Record<string, string> = {}) {
    const child = startServerProcess(['scripts/admin-create.mjs', ...args], settings)
    child.child.stdin?.end(input ?? '')
    const code = await child.exited
    const output = child.output()
    expect(output).not.toContain('hunter2')
    expect(output).not.toContain(password)
    return { code, output }
  }

  async function dataDir() {
    const dir = join(await createTempDir(), 'db')
    const database = await openDatabase({ kind: 'embedded', dataDir: dir })
    await applyMigrations(database)
    await database.close()
    return dir
  }

  it.each([
    ['no terminal and no password', ['--name', 'Ada', '--email', 'a@jet.example'], {}, '--password-stdin'],
    ['no terminal and no name', ['--email', 'a@jet.example', '--password-stdin'], {}, '--name'],
    ['no terminal and no email', ['--name', 'Ada', '--password-stdin'], {}, '--email'],
    ['a reset without password', ['--reset', 'a@jet.example'], {}, '--password-stdin'],
    ['a password as an option', ['--password=hunter2'], {}, 'cannot be given as an option'],
    ['a password as an argument', ['hunter2'], {}, 'cannot be given as an option'],
    ['an unreachable database', ['--name', 'Ada', '--email', 'a@jet.example', '--password-stdin'], { DATABASE_URL: 'postgres://u:hunter2@127.0.0.1:1/x' }, 'Cannot connect'],
    ['no database in production', ['--name', 'Ada', '--email', 'a@jet.example', '--password-stdin'], { NODE_ENV: 'production' }, 'DATABASE_URL'],
  ])('fails for %s', async (_name, args, settings, message) => {
    const { code, output } = await command(args, settings)
    expect(code).toBe(1)
    expect(output).toContain(message)
  })

  it('fails for pending migrations and for a folder in use', async () => {
    const empty = join(await createTempDir(), 'db')
    const args = ['--name', 'Ada', '--email', 'a@jet.example', '--password-stdin', '--data-dir']
    const pending = await command([...args, empty], { input: password })
    expect([pending.code, pending.output]).toEqual([1, expect.stringContaining('npm run db:migrate')])
    const dir = await dataDir()
    const database = await openDatabase({ kind: 'embedded', dataDir: dir })
    const used = await command([...args, dir], { input: password })
    expect([used.code, used.output]).toEqual([1, expect.stringMatching(/^JETStream: .* is in use by process/m)])
    expect(await database.db.select().from(people)).toEqual([])
    await database.close()
  })

  it('creates, refuses weak passwords and a second one, and resets', async () => {
    const dir = await dataDir()
    const create = (input: string, email = 'Ada@JET.example') =>
      command(['--name', 'Ada Admin', '--email', email, '--password-stdin', '--data-dir', dir], { input })
    for (const weak of ['short', 'jetdemo123', 'ada@jet.example', '']) expect((await create(weak)).code).toBe(1)
    const made = await create(`${password}\n`)
    expect([made.code, made.output]).toEqual([0, expect.stringContaining('Ada Admin (ada@jet.example) is an administrator')])
    const second = await create(password, 'b@jet.example')
    expect([second.code, second.output]).toEqual([1, expect.stringContaining('administrator already')])
    const reset = (email: string, input: string) => command(['--reset', email, '--password-stdin', '--data-dir', dir], { input })
    expect((await reset('ada@jet.example', 'short')).code).toBe(1)
    expect((await reset('b@jet.example', password)).output).toContain('no active administrator')
    expect((await reset('ADA@jet.example', 'another password')).code).toBe(0)
    const database = await openDatabase({ kind: 'embedded', dataDir: dir })
    expect(await database.db.select().from(personCredentials)).toHaveLength(1)
    const app = testApp({ db: database.db })
    expect((await browser(app).signIn('ada@jet.example', password)).status).toBe(401)
    expect((await browser(app).signIn('ada@jet.example', 'another password')).status).toBe(200)
    await database.close()
  })
})
