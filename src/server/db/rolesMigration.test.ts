// The migrations from 0005 on, on a database as 004 left it.
import { cp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { loadActor } from '../access/actor'
import { seedDemo } from '../demo'
import { migrationsDir } from '../paths'
import { roleGrants } from '../../shared/permissions'
import { createTempDir, queryRows } from '../testing/testDatabase'
import { openDatabase } from './database'
import { applyMigrations, countPendingMigrations } from './migrations'
import { invites, people, personExtras, roles } from './schema'

/** The migrations up to 004. */
async function olderMigrations(): Promise<string> {
  const dir = join(await createTempDir(), 'drizzle')
  await cp(migrationsDir, dir, { recursive: true })
  const path = join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(path, 'utf8')) as { entries: { idx: number }[] }
  journal.entries = journal.entries.filter(({ idx }) => idx < 5)
  await writeFile(path, JSON.stringify(journal))
  return dir
}

it('keeps the role of everyone, gives nobody more, and does nothing the second time', { timeout: 60_000 }, async () => {
  const source = await openDatabase({ kind: 'embedded', dataDir: 'memory://' })
  const database = await openDatabase({ kind: 'embedded', dataDir: 'memory://' })
  const { db } = database
  try {
    // What the seed fills, without what 005 added to it, goes into a database of 004.
    await applyMigrations(source)
    await seedDemo(source.db, { today: '2026-03-04' })
    expect(await applyMigrations(database, await olderMigrations())).toBe(5)
    const builtIn = await source.db.select().from(roles).where(eq(roles.builtIn, true))
    const member = builtIn.find(({ key }) => key === 'member')?.id ?? 0
    const columns = ['id', 'name', 'email', 'status', 'kind', 'role_id', 'weekly_capacity_minutes']
    const persons = await queryRows<Record<string, unknown>>(source.db, sql.raw(`select ${columns.join(', ')} from people order by id`))
    for (const person of persons) {
      if (!builtIn.some(({ id }) => id === person.role_id)) person.role_id = member
      const values = columns.map((column) => sql`${person[column]}`)
      await db.execute(sql`insert into people (${sql.raw(columns.join(', '))}) values (${sql.join(values, sql`, `)})`)
    }
    // What 004's actions leave: invites, and a permission list that meant nothing yet.
    for (const role of [1, 2, 3]) {
      await db.execute(sql`insert into invites (token_hash, name, email, role_id, created_by, expires_at) values (${`hash${role}`}, 'Ivy', ${`i${role}@client.example`}, ${role}, 1, now() + interval '1 day')`)
    }
    await db.execute(sql`update roles set permissions = '["cost.view:all"]' where key = 'member'`)
    await db.execute(sql`insert into roles (name) values ('Accounting')`)
    const before = await queryRows(db, sql`select id, role_id, status from people order by id`)

    expect(await countPendingMigrations(db)).toBe(3)
    expect(await applyMigrations(database)).toBe(3)
    expect(await queryRows(db, sql`select id, role_id, status from people order by id`)).toEqual(before)
    const rolesNow = await db.select().from(roles).orderBy(roles.id)
    expect(rolesNow.map(({ key, builtIn: is, permissions, name }) => [key, is, permissions, name])).toEqual([
      ['administrator', true, [], 'Administrator'], ['manager', true, [], 'Project Manager'], ['member', true, [], 'Member'],
      // Whoever made a role with the name of a new one keeps it under another.
      [null, false, [], 'Accounting (custom 4)'],
      ['people_admin', true, [], 'People Admin'], ['accounting', true, [], 'Accounting'], ['executive', true, [], 'Executive Manager'],
    ])
    for (const person of await db.select().from(people)) {
      const role = rolesNow.find(({ id }) => id === person.roleId)
      const actor = await loadActor(db, person.id)
      expect(actor.grants).toEqual(person.status === 'active' && role ? roleGrants(role) : {})
      expect(actor.administrator).toBe(person.status === 'active' && role?.key === 'administrator')
    }
    expect(await db.select().from(personExtras)).toEqual([])
    expect((await db.select().from(invites)).map(({ roleId, endedAt }) => [roleId, endedAt])).toEqual([[1, null], [2, null], [3, null]])

    const dump = () => queryRows(db, sql`select (select json_agg(r) from roles r) as roles, (select json_agg(p) from people p) as people, (select json_agg(i) from invites i) as invites`)
    const after = JSON.stringify(await dump())
    expect(await applyMigrations(database)).toBe(0)
    // Nor does the statement about the built-in roles, were it run again.
    const text = await readFile(join(migrationsDir, '0005_roles_permissions.sql'), 'utf8')
    await db.execute(sql.raw(text.slice(text.lastIndexOf('UPDATE "roles"'))))
    expect(JSON.stringify(await dump())).toBe(after)
  } finally {
    await source.close()
    await database.close()
  }
})
