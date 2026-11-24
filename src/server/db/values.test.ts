import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { type Make, makeRecords } from '../testing/records'
import { createTestDatabase } from '../testing/testDatabase'
import { type Database, sumExact } from '.'
import { fromDatabaseInteger, toDatabaseInteger } from './numbers'
import { files, personRates, projects, timeEntries } from './schema'

let database: Database
let make: Make
beforeAll(async () => {
  database = await createTestDatabase()
  make = makeRecords(database.db)
})
afterAll(() => database.close())

const max = Number.MAX_SAFE_INTEGER

describe('dates', () => {
  it.each([
    ['America/Los_Angeles', 480],
    ['UTC', 0],
    ['Pacific/Auckland', -780],
  ])('round-trip unchanged with TZ=%s', async (zone, januaryOffset) => {
    const before = process.env.TZ
    onTestFinished(() => {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    })
    process.env.TZ = zone
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(januaryOffset) // The setting took effect.

    const there = await createTestDatabase()
    const makeThere = makeRecords(there.db)
    const { place } = await makeThere.workplace()
    for (const spentOn of ['2026-03-08', '2026-11-01', '2028-02-29', '2026-12-31', '2026-01-01']) {
      const { id } = await makeThere.timeEntry({ ...place, spentOn })
      const [entry] = await there.db.select().from(timeEntries).where(eq(timeEntries.id, id))
      expect(entry?.spentOn).toBe(spentOn)
      const [asText] = await there.db
        .select({ text: sql<string>`spent_on::text` })
        .from(timeEntries)
        .where(eq(timeEntries.spentOn, spentOn))
      expect(asText?.text).toBe(spentOn)
    }
    // And instants stay the same moment.
    const moment = new Date('2026-03-08T08:30:00.123Z')
    const { id } = await makeThere.timeEntry({ ...place, timerStartedAt: moment })
    const [running] = await there.db.select().from(timeEntries).where(eq(timeEntries.id, id))
    expect(running?.timerStartedAt?.toISOString()).toBe(moment.toISOString())
    await there.close()
  })
})

describe('money', () => {
  it('round-trips the largest exact value, also as a sum', async () => {
    const client = await make.client()
    const { id } = await make.project({ clientId: client.id, fixedFee: max })
    const [project] = await database.db.select().from(projects).where(eq(projects.id, id))
    expect(project?.fixedFee).toBe(max)
    const total = () =>
      database.db.select({ total: sumExact(projects.fixedFee) }).from(projects).where(eq(projects.clientId, client.id))
    expect(await total()).toEqual([{ total: max }])
    await make.project({ clientId: client.id, fixedFee: 1 })
    await expect(total()).rejects.toThrow('too large')
  })

  it('refuses to store or read a larger value', async () => {
    const client = await make.client()
    await expect(make.project({ clientId: client.id, fixedFee: max + 1 })).rejects.toThrow()
    await expect(make.project({ clientId: client.id, fixedFee: 0.5 })).rejects.toThrow()
    const { id } = await make.project({ clientId: client.id })
    await database.db.execute(sql`update projects set fixed_fee = 9007199254740992 where id = ${id}`)
    await expect(database.db.select().from(projects).where(eq(projects.id, id)).execute()).rejects.toThrow('too large')
    await database.db.execute(sql`update projects set fixed_fee = 9007199254740993 where id = ${id}`)
    await expect(database.db.select().from(projects).where(eq(projects.id, id)).execute()).rejects.toThrow('too large')
  })

  it('reads what either driver returns', () => {
    for (const value of [String(max), max, BigInt(max)]) expect(fromDatabaseInteger(value)).toBe(max)
    for (const value of [`-${max}`, -max]) expect(fromDatabaseInteger(value)).toBe(-max)
    for (const value of ['9007199254740992', 9007199254740993n, max + 1, '1.5', '', 'abc', NaN]) {
      expect(() => fromDatabaseInteger(value)).toThrow()
    }
    expect(toDatabaseInteger(-max)).toBe(`-${max}`)
  })

  it('sums to 0 without rows, and sums minutes as a number', async () => {
    const { place } = await make.workplace()
    const minutes = () =>
      database.db
        .select({ total: sumExact(timeEntries.minutes) })
        .from(timeEntries)
        .where(eq(timeEntries.personId, place.personId))
    expect(await minutes()).toEqual([{ total: 0 }])
    await make.timeEntry({ ...place, minutes: 61 })
    await make.timeEntry({ ...place, minutes: 60 })
    expect(await minutes()).toEqual([{ total: 121 }])
  })

  it('keeps negative, zero and null apart', async () => {
    const person = await make.person()
    await database.db.insert(personRates).values({ personId: person.id, kind: 'cost', startsOn: '2026-01-01', rate: 0 })
    const [rate] = await database.db.select().from(personRates).where(eq(personRates.personId, person.id))
    expect(rate?.rate).toBe(0)
    const client = await make.client()
    expect((await make.project({ clientId: client.id })).fixedFee).toBeNull()
  })
})

it('keeps the content of a file', async () => {
  const content = Buffer.from([0, 1, 127, 128, 255, 0])
  const [file] = await database.db
    .insert(files)
    .values({ name: 'a.bin', mediaType: 'application/octet-stream', sizeBytes: 6, content })
    .returning()
  expect(file?.content.equals(content)).toBe(true)
})
