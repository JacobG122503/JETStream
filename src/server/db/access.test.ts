import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type Make, makeRecords } from '../testing/records'
import { createTestDatabase, sqlState } from '../testing/testDatabase'
import { type Database, NotFoundError, runTransaction, StaleError, updateVersioned } from '.'
import { appMeta, clients, timeEntries } from './schema'

let database: Database
let make: Make
beforeAll(async () => {
  database = await createTestDatabase()
  make = makeRecords(database.db)
})
afterAll(() => database.close())

describe('runTransaction', () => {
  beforeEach(() => database.db.delete(appMeta).then(() => undefined))
  const stored = () => database.db.select().from(appMeta)

  /** Writes a row, then fails with the code until `failures` are used up. */
  function failing(code: string, failures: number) {
    let attempts = 0
    const run = runTransaction(database.db, async (tx) => {
      attempts++
      await tx.insert(appMeta).values({ key: 'a', value: String(attempts) })
      if (attempts <= failures) {
        // A real error of the server, as a driver reports it.
        await tx.execute(sql.raw(`do $$ begin raise exception 'x' using errcode = '${code}'; end $$`))
      }
      return attempts
    })
    return { run, attempts: () => attempts }
  }

  it.each(['40001', '40P01'])('retries %s and keeps only the successful attempt', async (code) => {
    const { run } = failing(code, 2)
    expect(await run).toBe(3)
    expect(await stored()).toEqual([{ key: 'a', value: '3' }])
  })

  it.each(['40001', '40P01'])('gives up on %s after three attempts, keeping nothing', async (code) => {
    const { run, attempts } = failing(code, 99)
    expect(await sqlState(run)).toBe(code)
    expect(attempts()).toBe(3)
    expect(await stored()).toEqual([])
  })

  it.each(['23505', '55P03', '57014', '22012'])('does not retry %s', async (code) => {
    const { run, attempts } = failing(code, 1)
    expect(await sqlState(run)).toBe(code)
    expect(attempts()).toBe(1)
    expect(await stored()).toEqual([])
  })

  it('rolls back on any error of its own, without retrying', async () => {
    let attempts = 0
    const run = runTransaction(database.db, async (tx) => {
      attempts++
      await tx.insert(appMeta).values({ key: 'a', value: '1' })
      throw new Error('undo')
    })
    await expect(run).rejects.toThrow('undo')
    expect(attempts).toBe(1)
    expect(await stored()).toEqual([])
  })
})

describe('updateVersioned', () => {
  const read = async (id: number) => (await database.db.select().from(clients).where(eq(clients.id, id)))[0]

  it('changes the record and counts the version up', async () => {
    const client = await make.client()
    expect(client.version).toBe(1)
    const updated = await updateVersioned(database.db, clients, client.id, 1, { notes: 'New' })
    expect(updated).toMatchObject({ id: client.id, notes: 'New', version: 2, name: client.name })
    expect(await read(client.id)).toEqual(updated)
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(client.updatedAt.getTime())
    expect((await updateVersioned(database.db, clients, client.id, 2, {})).version).toBe(3)
  })

  it('refuses a version that is not the current one, changing nothing', async () => {
    const client = await make.client()
    await updateVersioned(database.db, clients, client.id, 1, { notes: 'First' })
    for (const version of [1, 3]) {
      const update = updateVersioned(database.db, clients, client.id, version, { notes: 'Second' })
      await expect(update).rejects.toBeInstanceOf(StaleError)
    }
    expect(await read(client.id)).toMatchObject({ notes: 'First', version: 2 })
  })

  it('tells a missing record from a stale one', async () => {
    const update = updateVersioned(database.db, clients, 999_999, 1, { notes: 'x' })
    await expect(update).rejects.toBeInstanceOf(NotFoundError)
  })

  it('lets one of two simultaneous edits win', async () => {
    const client = await make.client()
    const edits = ['a', 'b'].map((notes) => updateVersioned(database.db, clients, client.id, 1, { notes }))
    const results = await Promise.allSettled(edits)
    expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected'])
  })

  it('works in a transaction', async () => {
    const client = await make.client()
    const run = runTransaction(database.db, async (tx) => {
      await updateVersioned(tx, clients, client.id, 1, { notes: 'x' })
      throw new Error('undo')
    })
    await expect(run).rejects.toThrow('undo')
    expect(await read(client.id)).toMatchObject({ notes: '', version: 1 })
  })
})

it('counts the version up with any other update through Drizzle', async () => {
  const { place } = await make.workplace()
  const entry = await make.timeEntry(place)
  await database.db.update(timeEntries).set({ notes: 'x' }).where(eq(timeEntries.id, entry.id))
  const [after] = await database.db.select().from(timeEntries).where(eq(timeEntries.id, entry.id))
  expect(after?.version).toBe(2)
})
