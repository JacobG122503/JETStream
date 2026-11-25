// The embedded database has one connection, so there simultaneous transactions run in turn and
// these tests prove results, not lock contention. With TEST_DATABASE_URL they also run against a
// PostgreSQL server over separate connections.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { systemActor } from '../access/system'
import { type Database, runTransaction, updateVersioned } from '../db'
import { invoices, invoiceTimeEntries, payments, timeEntries } from '../db/schema'
import { type Make, makeRecords } from '../testing/records'
import { openTestServer, parseTestDatabaseUrl, testServerTimeoutMs } from '../testing/realServer'
import { createTestDatabase } from '../testing/testDatabase'
import {
  allocateNumber, BillingError, ClaimError, createInvoiceFromEntries, deleteInvoice, EntryLockedError, lockTimeEntryForEdit,
  type NewInvoice, recordPayment, recordRefund,
} from '.'

const system = systemActor('tests')

const serverUrl = parseTestDatabaseUrl(process.env)

describe('TEST_DATABASE_URL', () => {
  it('must name a database for tests', () => {
    const parse = (url?: string) => parseTestDatabaseUrl({ TEST_DATABASE_URL: url, DATABASE_URL: 'postgres://h/test' })
    expect(parse()).toBeUndefined()
    expect(parse('postgres://u:p@h/jet_test')).toBe('postgres://u:p@h/jet_test')
    expect(() => parse('postgres://test:test@test/jet')).toThrow('test')
    expect(() => parse('postgres://h/jet?application_name=test')).toThrow('test')
    expect(() => parse('postgres://h')).toThrow('test')
  })
})

describe.each([
  { name: 'embedded database', skip: false, separate: false, open: createTestDatabase },
  {
    name: 'PostgreSQL server, separate connections',
    skip: serverUrl === undefined,
    separate: true,
    open: () => openTestServer(serverUrl ?? ''),
  },
])('simultaneous billing: $name', ({ skip, separate, open }) => {
  let database: Database
  let make: Make
  beforeAll(async () => {
    if (skip) return
    database = await open()
    make = makeRecords(database.db)
  }, testServerTimeoutMs)
  afterAll(() => database?.close())

  const on = it.skipIf(skip)

  async function setUp(count: number) {
    const at = await make.workplace()
    const entries = []
    for (let index = 0; index < count; index++) entries.push(await make.timeEntry(at.place))
    const invoice: NewInvoice = {
      clientId: at.client.id, createdBy: at.person.id, currency: 'USD', issuedOn: '2026-04-01', dueOn: '2026-05-01',
    }
    const bill = (chosen: { id: number; version: number }[]) =>
      createInvoiceFromEntries(database.db, invoice, { timeEntries: chosen, expenses: [] })
    return { ...at, entries, bill }
  }
  const split = <T>(results: PromiseSettledResult<T>[]) => ({
    done: results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    failed: results.flatMap((result) => (result.status === 'rejected' ? [result.reason as unknown] : [])),
  })

  on('20 allocations give 20 consecutive numbers', async () => {
    const take = () => runTransaction(database.db, (tx) => allocateNumber(tx, 'invoice'))
    const numbers = (await Promise.all(Array.from({ length: 20 }, take))).map((number) => Number(number.slice(4)))
    const first = Math.min(...numbers)
    expect(numbers.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => first + index))
  })

  on('of 20 allocations, the ones rolled back leave no gap', async () => {
    const take = (index: number) =>
      runTransaction(database.db, async (tx) => {
        const number = await allocateNumber(tx, 'estimate')
        if (index % 2 === 0) throw new Error('undo')
        return number
      })
    const { done } = split(await Promise.allSettled(Array.from({ length: 20 }, (_, index) => take(index))))
    expect(done.sort()).toEqual(Array.from({ length: 10 }, (_, index) => `EST-${String(index + 1).padStart(4, '0')}`))
  })

  on.each([1, 2, 3])('of two overlapping bills exactly one succeeds (%i)', async () => {
    const { entries, bill } = await setUp(6)
    const before = (await database.db.select().from(invoices)).length
    const shared = entries[2]
    // In opposite orders, which must not make a deadlock.
    const attempts = [bill(entries.slice(0, 4)), bill(entries.slice(2).reverse())]
    const { done, failed } = split(await Promise.allSettled(attempts))
    expect([done.length, failed.length]).toEqual([1, 1])
    const [error] = failed
    expect(error).toBeInstanceOf(ClaimError)
    expect((error as ClaimError).problems.map(({ id, reason }) => [id, reason])).toContainEqual([
      shared?.id, 'already_invoiced',
    ])
    expect(done[0]?.total).toBe(40_000)
    expect((await database.db.select().from(invoices)).length).toBe(before + 1)
  })

  on('many bills of the same entries still bill each entry once', async () => {
    const { entries, bill } = await setUp(8)
    const attempts = Array.from({ length: 12 }, (_, index) => bill([...entries.slice(index % 8), ...entries.slice(0, index % 3)]))
    const { done, failed } = split(await Promise.allSettled(attempts))
    expect(done.length).toBeGreaterThan(0)
    for (const error of failed) expect(error).toBeInstanceOf(ClaimError)
    const links = await database.db.select().from(invoiceTimeEntries)
    const total = done.reduce((sum, invoice) => sum + invoice.total, 0)
    expect(total).toBe(10_000 * links.filter(({ timeEntryId }) => entries.some(({ id }) => id === timeEntryId)).length)
  })

  on.each([1, 2, 3, 4, 5, 6])('a bill racing an edit never bills a value other than the stored one (%i)', async (round) => {
    const { entries, bill } = await setUp(1)
    const [entry] = entries
    if (!entry) throw new Error('No entry')
    const edit = () =>
      runTransaction(database.db, async (tx) => {
        await lockTimeEntryForEdit(tx, system, entry.id, 1)
        await updateVersioned(tx, timeEntries, entry.id, 1, { minutes: 30 })
      })
    // Started in either order.
    const [first, second] = round % 2 === 0 ? [bill([entry]), edit()] : [edit(), bill([entry])]
    const results = await Promise.allSettled([first, second])
    const [billed, edited] = round % 2 === 0 ? results : [results[1], results[0]]
    expect([billed.status, edited.status].sort()).toEqual(['fulfilled', 'rejected'])
    const [stored] = await database.db.select().from(timeEntries).where(eq(timeEntries.id, entry.id))
    const links = await database.db.select().from(invoiceTimeEntries).where(eq(invoiceTimeEntries.timeEntryId, entry.id))
    if (billed.status === 'fulfilled') {
      expect(links).toMatchObject([{ minutes: stored?.minutes }])
      expect(stored?.minutes).toBe(60)
      expect(edited.status === 'rejected' && edited.reason).toBeInstanceOf(EntryLockedError)
    } else {
      expect(links).toEqual([])
      expect(stored?.minutes).toBe(30)
      expect(billed.reason).toBeInstanceOf(ClaimError)
    }
  })

  on('of two payments of the full amount exactly one succeeds', async () => {
    const { entries, bill } = await setUp(1)
    const { id } = await bill(entries)
    await database.db.update(invoices).set({ status: 'open' }).where(eq(invoices.id, id))
    const pay = () => recordPayment(database.db, { invoiceId: id, amount: 10_000, paidOn: '2026-05-01', method: 'check' })
    const { done, failed } = split(await Promise.allSettled([pay(), pay()]))
    expect([done.length, failed.length]).toEqual([1, 1])
    expect((failed[0] as BillingError).problem).toBe('payment_exceeds_due')
    expect(await database.db.select().from(payments).where(eq(payments.invoiceId, id))).toHaveLength(1)
    const [invoice] = await database.db.select().from(invoices).where(eq(invoices.id, id))
    expect(invoice).toMatchObject({ status: 'paid', dueAmount: 0 })

    const [payment] = done
    const giveBack = () =>
      recordRefund(database.db, { paymentId: payment?.payment.id ?? 0, amount: 10_000, refundedOn: '2026-05-02' })
    const refunds = split(await Promise.allSettled([giveBack(), giveBack()]))
    expect([refunds.done.length, refunds.failed.length]).toEqual([1, 1])
  })

  on('of a payment and a deletion exactly one succeeds', async () => {
    const { entries, bill } = await setUp(1)
    const { id } = await bill(entries)
    const [opened] = await database.db.update(invoices).set({ status: 'open' }).where(eq(invoices.id, id)).returning()
    const { done, failed } = split(
      await Promise.allSettled<unknown>([
        recordPayment(database.db, { invoiceId: id, amount: 1, paidOn: '2026-05-01', method: 'check' }),
        deleteInvoice(database.db, id, opened?.version ?? 0),
      ]),
    )
    expect([done.length, failed.length]).toEqual([1, 1])
  })

  it.skipIf(skip || !separate)('recovers from a deadlock', async () => {
    const { entries } = await setUp(2)
    const [a, b] = entries
    if (!a || !b) throw new Error('No entries')
    let attempts = 0
    const touch = (first: number, second: number) =>
      runTransaction(database.db, async (tx) => {
        attempts++
        await tx.update(timeEntries).set({ notes: 'x' }).where(eq(timeEntries.id, first))
        await new Promise((resolve) => setTimeout(resolve, 200))
        await tx.update(timeEntries).set({ notes: 'x' }).where(eq(timeEntries.id, second))
      })
    await Promise.all([touch(a.id, b.id), touch(b.id, a.id)])
    expect(attempts).toBeGreaterThan(2)
  })
})
