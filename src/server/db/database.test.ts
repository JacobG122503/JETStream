import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { errorCode } from '../errors'
import { migrationsDir } from '../paths'
import { createTempDir, createTestDatabase } from '../testing/testDatabase'
import { type Database, openDatabase } from './database'
import { lockDataDir } from './dataDirLock'
import { applyMigrations, countPendingMigrations } from './migrations'
import { appMeta } from './schema'

async function sqlState(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action
  } catch (error) {
    return errorCode(error)
  }
  throw new Error('Expected the query to fail')
}

describe('embedded database', () => {
  let database: Database
  beforeEach(async () => {
    database = await createTestDatabase()
  })
  afterEach(() => database.close())

  it('keeps what a transaction commits', async () => {
    await database.db.transaction((tx) => tx.insert(appMeta).values({ key: 'a', value: '1' }))
    expect(await database.db.select().from(appMeta)).toEqual([{ key: 'a', value: '1' }])
  })

  it('leaves no row after a rollback', async () => {
    const failing = database.db.transaction(async (tx) => {
      await tx.insert(appMeta).values({ key: 'a', value: '1' })
      throw new Error('undo')
    })
    await expect(failing).rejects.toThrow('undo')
    expect(await database.db.select().from(appMeta)).toEqual([])
  })

  it('reports a duplicate key as 23505', async () => {
    await database.db.insert(appMeta).values({ key: 'a', value: '1' })
    const duplicate = database.db.insert(appMeta).values({ key: 'a', value: '2' })
    expect(await sqlState(duplicate.execute())).toBe('23505')
  })

  it('reports a null in a required column as 23502', async () => {
    const insert = database.db.execute(sql`insert into app_meta (key, value) values ('a', null)`)
    expect(await sqlState(Promise.resolve(insert))).toBe('23502')
  })

  it('counts 20 simultaneous locked increments correctly', async () => {
    await database.db.insert(appMeta).values({ key: 'n', value: '0' })
    const increment = () =>
      database.db.transaction(async (tx) => {
        const [row] = await tx.select().from(appMeta).where(eq(appMeta.key, 'n')).for('update')
        await new Promise((resolve) => setTimeout(resolve, 5))
        await tx
          .update(appMeta)
          .set({ value: String(Number(row?.value) + 1) })
          .where(eq(appMeta.key, 'n'))
      })
    await Promise.all(Array.from({ length: 20 }, increment))
    expect(await database.db.select().from(appMeta)).toEqual([{ key: 'n', value: '20' }])
  })
})

describe('embedded database folder', () => {
  it('keeps its data after closing and reopening', async () => {
    const dataDir = join(await createTempDir(), 'db')
    const first = await openDatabase({ kind: 'embedded', dataDir })
    await applyMigrations(first)
    await first.db.insert(appMeta).values({ key: 'a', value: 'kept' })
    await first.close()

    const second = await openDatabase({ kind: 'embedded', dataDir })
    expect(await applyMigrations(second)).toBe(0)
    expect(await second.db.select().from(appMeta)).toEqual([{ key: 'a', value: 'kept' }])
    await second.close()
  })

  it('is opened by one process at a time', async () => {
    const dataDir = join(await createTempDir(), 'db')
    const unlock = await lockDataDir(dataDir)
    await expect(lockDataDir(dataDir, 0)).rejects.toThrow('in use')
    await unlock()
    await (await lockDataDir(dataDir, 0))()
  })

  it('takes over a lock left by a process that is gone', async () => {
    const dataDir = join(await createTempDir(), 'db')
    await writeFile(`${dataDir}.lock`, '99999999')
    await (await lockDataDir(dataDir, 0))()
  })
})

describe('migrations', () => {
  async function tables(database: Database) {
    const rows = await database.db.execute(
      sql`select table_schema || '.' || table_name as name from information_schema.tables
          where table_schema not in ('pg_catalog', 'information_schema') order by 1`,
    )
    const records = await database.db.execute(sql`select hash from drizzle.__drizzle_migrations`)
    return JSON.stringify([rows, records])
  }

  it('changes nothing when applied twice', async () => {
    const database = await openDatabase({ kind: 'embedded', dataDir: 'memory://' })
    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).length
    expect(files).toBeGreaterThan(0)
    expect(await countPendingMigrations(database.db)).toBe(files)
    expect(await applyMigrations(database)).toBe(files)
    const before = await tables(database)
    expect(before).toContain('public.app_meta')
    expect(await countPendingMigrations(database.db)).toBe(0)
    expect(await applyMigrations(database)).toBe(0)
    await database.runMigrations(migrationsDir)
    expect(await tables(database)).toBe(before)
    await database.close()
  })

  it('reports a migration that is older than the last applied one', async () => {
    const database = await createTestDatabase()
    const folder = join(await createTempDir(), 'drizzle')
    await cp(migrationsDir, folder, { recursive: true })
    const journalFile = join(folder, 'meta', '_journal.json')
    const journal = JSON.parse(await readFile(journalFile, 'utf8')) as { entries: object[] }
    journal.entries.push({ idx: 99, version: '7', when: 1, tag: '0099_late', breakpoints: true })
    await writeFile(journalFile, JSON.stringify(journal))
    await writeFile(join(folder, '0099_late.sql'), 'create table late (id integer);')
    await expect(applyMigrations(database, folder)).rejects.toThrow('older than the last applied one')
    await database.close()
  })
})
