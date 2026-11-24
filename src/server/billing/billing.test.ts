import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { documentTotals, timeAmount } from '../../shared/calc'
import type { RoundingMode } from '../../shared/domain'
import { type Database, NotFoundError, runTransaction, StaleError, updateVersioned } from '../db'
import {
  companySettings, invoiceExpenses, invoiceLines, invoices, invoiceTimeEntries, numberSequences, payments, personRates,
  projectMembers, projects, refunds, timeEntries,
} from '../db/schema'
import { type Make, makeRecords } from '../testing/records'
import { createTestDatabase, sqlState } from '../testing/testDatabase'
import {
  addEntriesToInvoice, allocateNumber, BillingError, changeInvoiceLines, type Claim, ClaimError, createInvoiceFromEntries,
  deleteInvoice, EntryLockedError, lockExpenseForEdit, lockTimeEntryForEdit, type NewInvoice, recordPayment, recordRefund,
} from '.'

let database: Database
let make: Make
beforeAll(async () => {
  database = await createTestDatabase()
  make = makeRecords(database.db)
})
afterAll(() => database.close())

type Workplace = Awaited<ReturnType<Make['workplace']>>
let at: Workplace
let invoice: NewInvoice
beforeEach(async () => {
  at = await make.workplace()
  invoice = {
    clientId: at.client.id, createdBy: at.person.id, currency: 'USD', issuedOn: '2026-04-01', dueOn: '2026-05-01',
  }
})

const claim = (entries: { id: number; version: number }[], more: Partial<Claim> = {}): Claim => ({
  timeEntries: entries.map(({ id, version }) => ({ id, version })), expenses: [], ...more,
})
const bill = (entries: { id: number; version: number }[], more: Partial<Claim> = {}) =>
  createInvoiceFromEntries(database.db, invoice, claim(entries, more))
const linesOf = (id: number) =>
  database.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(invoiceLines.position)
const linksOf = (lineId: number) =>
  database.db.select().from(invoiceTimeEntries).where(eq(invoiceTimeEntries.lineId, lineId))
const invoiceOf = async (id: number) => (await database.db.select().from(invoices).where(eq(invoices.id, id)))[0]

/** What must not change when billing fails. */
async function everything() {
  const { db } = database
  return JSON.stringify([
    await db.select().from(invoices).orderBy(invoices.id),
    await db.select().from(invoiceLines).orderBy(invoiceLines.id),
    await db.select().from(invoiceTimeEntries).orderBy(invoiceTimeEntries.timeEntryId),
    await db.select().from(invoiceExpenses).orderBy(invoiceExpenses.expenseId),
    await db.select().from(numberSequences).orderBy(numberSequences.kind),
    await db.select().from(payments).orderBy(payments.id),
    await db.select().from(refunds).orderBy(refunds.id),
  ])
}

async function problemsOf(action: Promise<unknown>) {
  const error: unknown = await action.then(() => undefined, (reason: unknown) => reason)
  if (!(error instanceof ClaimError)) throw new Error(`Expected a ClaimError, not ${String(error)}`)
  return error.problems
}

async function expectProblem(action: Promise<unknown>, problem: string) {
  const error: unknown = await action.then(() => undefined, (reason: unknown) => reason)
  expect(error).toBeInstanceOf(BillingError)
  expect((error as BillingError).problem).toBe(problem)
}

describe('numbers', () => {
  const take = () => runTransaction(database.db, (tx) => allocateNumber(tx, 'invoice'))
  const numeric = (number: string) => Number(/\d+$/.exec(number)?.[0])

  it('are consecutive, with prefix and digits', async () => {
    const first = await take()
    expect(first).toMatch(/^INV-\d{4}$/)
    expect(numeric(await take())).toBe(numeric(first) + 1)
    expect(await runTransaction(database.db, (tx) => allocateNumber(tx, 'estimate'))).toMatch(/^EST-\d{4}$/)
  })

  it('are not used up by a rollback', async () => {
    const before = await take()
    let lost = ''
    const failing = runTransaction(database.db, async (tx) => {
      lost = await allocateNumber(tx, 'invoice')
      throw new Error('undo')
    })
    await expect(failing).rejects.toThrow('undo')
    expect(numeric(lost)).toBe(numeric(before) + 1)
    expect(await take()).toBe(lost)
  })

  it('skip ones that were given by hand, also if that invoice was deleted since', async () => {
    const next = numeric(await take()) + 1
    const number = (offset: number) => `INV-${String(next + offset).padStart(4, '0')}`
    await make.invoice({ clientId: at.client.id, createdBy: at.person.id, number: number(0) })
    const second = await make.invoice({ clientId: at.client.id, createdBy: at.person.id, number: number(1) })
    await deleteInvoice(database.db, second.id, second.version)
    expect(await take()).toBe(number(2))
  })
})

describe('claiming', () => {
  it('bills time and expenses, with totals', async () => {
    const entries = [await make.timeEntry({ ...at.place, minutes: 90 }), await make.timeEntry({ ...at.place, minutes: 20 })]
    const category = await make.category({ name: 'Mileage', unitName: 'mile', unitPrice: 65_500 })
    const expense = await make.expense({ ...at.place, categoryId: category.id, amount: 8083 })
    const made = await createInvoiceFromEntries(
      database.db,
      { ...invoice, discountPercent: 10_000, tax1Name: 'Sales tax', tax1Percent: 8250 },
      claim(entries, { expenses: [{ id: expense.id, version: 1 }], timeLines: { tax1: true } }),
    )
    const lines = await linesOf(made.id)
    expect(lines).toMatchObject([
      {
        kind: 'time', minutes: 110, quantity: 1833, unitPrice: 10_000, amount: 18_333, position: 1,
        projectId: at.project.id, description: `${at.project.name}, ${at.task.name}`,
      },
      { kind: 'expense', minutes: null, quantity: 1000, unitPrice: 8083, amount: 8083, position: 2 },
    ])
    expect(await linksOf(lines[0]?.id ?? 0)).toMatchObject([
      { timeEntryId: entries[0]?.id, minutes: 90, rate: 10_000, amount: 15_000 },
      { timeEntryId: entries[1]?.id, minutes: 20, rate: 10_000, amount: 3333 },
    ])
    expect(await database.db.select().from(invoiceExpenses).where(eq(invoiceExpenses.expenseId, expense.id))).toEqual([
      { expenseId: expense.id, lineId: lines[1]?.id, amount: 8083 },
    ])
    const totals = documentTotals(lines, made)
    expect(made).toMatchObject({
      status: 'draft', subtotal: 26_416, discountAmount: 2642, tax1Amount: 1361, total: totals.total, dueAmount: totals.total,
      paidAmount: 0,
    })
    expect(made.number).toMatch(/^INV-/)
  })

  it('adds to a draft or open invoice, and to no other', async () => {
    const first = await bill([await make.timeEntry(at.place)])
    const add = async (seen: { id: number; version: number }) =>
      addEntriesToInvoice(database.db, seen, claim([await make.timeEntry(at.place)]))
    const second = await add(first)
    expect(second).toMatchObject({ id: first.id, total: 20_000, dueAmount: 20_000 })
    expect((await linesOf(first.id)).map(({ position }) => position)).toEqual([1, 2])
    await expect(add(first)).rejects.toBeInstanceOf(StaleError)
    await expect(add({ id: 999_999, version: 1 })).rejects.toBeInstanceOf(NotFoundError)
    for (const status of ['open', 'paid', 'closed'] as const) {
      const [changed] = await database.db.update(invoices).set({ status }).where(eq(invoices.id, first.id)).returning()
      if (!changed) throw new Error('No invoice')
      if (status === 'open') expect(await add(changed)).toMatchObject({ status: 'open', total: 30_000 })
      else await expectProblem(add(changed), 'invoice_not_editable')
    }
  })

  it('splits grouped lines by rate, and keeps them when rates change', async () => {
    await database.db.update(projects).set({ rateMethod: 'person' }).where(eq(projects.id, at.project.id))
    await database.db.insert(personRates).values([
      { personId: at.person.id, kind: 'billable', startsOn: '2026-01-01', rate: 10_000 },
      { personId: at.person.id, kind: 'billable', startsOn: '2026-03-03', rate: 12_000 },
    ])
    const entries = [
      await make.timeEntry({ ...at.place, spentOn: '2026-03-01' }),
      await make.timeEntry({ ...at.place, spentOn: '2026-03-02', minutes: 50 }),
      await make.timeEntry({ ...at.place, spentOn: '2026-03-03' }),
    ]
    const made = await bill(entries)
    const lines = await linesOf(made.id)
    expect(lines).toMatchObject([
      { minutes: 110, unitPrice: 10_000, amount: 18_333 },
      { minutes: 60, unitPrice: 12_000, amount: 12_000 },
    ])
    for (const line of lines) {
      const links = await linksOf(line.id)
      expect(links.reduce((sum, { minutes }) => sum + minutes, 0)).toBe(line.minutes)
      for (const link of links) {
        expect(link.rate).toBe(line.unitPrice)
        expect(link.amount).toBe(timeAmount(link.minutes, link.rate))
      }
    }

    const before = [await invoiceOf(made.id), lines, await linksOf(lines[0]?.id ?? 0)]
    await database.db.update(personRates).set({ rate: 99_900 }).where(eq(personRates.personId, at.person.id))
    await database.db.update(projects).set({ rate: 99_900, rateMethod: 'project' }).where(eq(projects.id, at.project.id))
    expect([await invoiceOf(made.id), await linesOf(made.id), await linksOf(lines[0]?.id ?? 0)]).toEqual(before)

    await deleteInvoice(database.db, made.id, made.version)
    const again = await bill(entries)
    expect(again.number).not.toBe(made.number)
    expect(again.total).toBe(Math.round((99_900 * 170) / 60))
  })

  it.each([
    ['task', 2],
    ['person', 2],
    ['project', 1],
    ['detailed', 4],
  ] as const)('groups time by %s', async (timeGrouping, count) => {
    const other = await make.person()
    const otherTask = await make.task()
    await make.projectTask({ projectId: at.project.id, taskId: otherTask.id })
    const entries = []
    for (const personId of [at.person.id, other.id]) {
      for (const taskId of [at.task.id, otherTask.id]) entries.push(await make.timeEntry({ ...at.place, personId, taskId }))
    }
    const made = await bill(entries, { timeGrouping })
    expect(await linesOf(made.id)).toHaveLength(count)
    expect(made.total).toBe(40_000)
  })

  it('keeps projects and expense groups on lines of their own', async () => {
    const project = await make.project({ clientId: at.client.id, rate: 10_000 })
    await make.projectTask({ projectId: project.id, taskId: at.task.id })
    const entries = [await make.timeEntry(at.place), await make.timeEntry({ ...at.place, projectId: project.id })]
    const [travel, meals] = [await make.category(), await make.category()]
    const costs = [
      await make.expense({ ...at.place, categoryId: travel.id }),
      await make.expense({ ...at.place, categoryId: travel.id }),
      await make.expense({ ...at.place, categoryId: meals.id }),
    ]
    const made = await bill(entries, { timeGrouping: 'project', expenses: costs.map(({ id }) => ({ id, version: 1 })) })
    expect((await linesOf(made.id)).map(({ kind, amount }) => [kind, amount])).toEqual([
      ['time', 10_000], ['time', 10_000], ['expense', 2000], ['expense', 1000],
    ])
  })

  it.each<[RoundingMode, number[]]>([
    ['up', [30, 30]],
    ['nearest', [15, 30]],
    ['down', [15, 15]],
    ['off', [16, 23]],
  ])('rounds each entry %s before adding up, and not the stored minutes', async (roundingMode, billed) => {
    await database.db.update(companySettings).set({ roundingMode, roundingMinutes: 15 })
    try {
      const entries = [await make.timeEntry({ ...at.place, minutes: 16 }), await make.timeEntry({ ...at.place, minutes: 23 })]
      const made = await bill(entries)
      const [line] = await linesOf(made.id)
      expect((await linksOf(line?.id ?? 0)).map(({ minutes }) => minutes)).toEqual(billed)
      expect(line?.minutes).toBe((billed[0] ?? 0) + (billed[1] ?? 0))
      const stored = await database.db.select().from(timeEntries).where(eq(timeEntries.projectId, at.project.id))
      expect(stored.map(({ minutes }) => minutes)).toEqual([16, 23])
    } finally {
      await database.db.update(companySettings).set({ roundingMode: 'off' })
    }
  })

  it('bills hours of a fixed fee or without a rate at 0, and refuses a missing rate', async () => {
    const fixed = await make.project({ clientId: at.client.id, type: 'fixed_fee', fixedFee: 500_000 })
    const none = await make.project({ clientId: at.client.id, rateMethod: 'none' })
    const missing = await make.project({ clientId: at.client.id, rateMethod: 'person' })
    const on = async (project: { id: number }) => {
      await make.projectTask({ projectId: project.id, taskId: at.task.id })
      return make.timeEntry({ ...at.place, projectId: project.id })
    }
    expect(await bill([await on(fixed), await on(none)])).toMatchObject({ total: 0 })
    const entry = await on(missing)
    expect(await problemsOf(bill([entry]))).toEqual([{ kind: 'time', id: entry.id, reason: 'missing_rate' }])
    await database.db.insert(projectMembers).values({ projectId: missing.id, personId: at.person.id, rate: 0 })
    expect(await bill([entry])).toMatchObject({ total: 0 })
  })

  it('refuses entries already billed, leaving no trace', async () => {
    const { db } = database
    const [a, b] = [await make.timeEntry(at.place), await make.timeEntry(at.place)]
    await bill([b])
    const before = await everything()
    expect(await problemsOf(bill([a, b]))).toEqual([{ kind: 'time', id: b.id, reason: 'already_invoiced' }])
    expect(await everything()).toBe(before)
    const [link] = await db.select().from(invoiceTimeEntries).where(eq(invoiceTimeEntries.timeEntryId, b.id))
    const raw = sql`insert into invoice_time_entries (time_entry_id, line_id, minutes, rate, amount)
      values (${b.id}, ${link?.lineId}, 60, 1, 1)`
    expect(await sqlState(db.execute(raw))).toBe('23505')
    await bill([a])
  })

  it('refuses an entry changed since the caller loaded it', async () => {
    const entry = await make.timeEntry({ ...at.place, version: 3 })
    await updateVersioned(database.db, timeEntries, entry.id, 3, { minutes: 30 })
    const before = await everything()
    expect(await problemsOf(bill([entry]))).toEqual([{ kind: 'time', id: entry.id, reason: 'stale' }])
    expect(await everything()).toBe(before)
    expect(await bill([{ id: entry.id, version: 4 }])).toMatchObject({ total: 5000 })
  })

  it('lists every entry that cannot be billed, with the reason', async () => {
    const elsewhere = await make.workplace()
    const internal = await make.project({ clientId: at.client.id, type: 'non_billable' })
    await make.projectTask({ projectId: internal.id, taskId: at.task.id })
    const runner = await make.person()
    const category = await make.category()
    const cost = { ...at.place, categoryId: category.id }
    const good = await make.timeEntry(at.place)
    const bad = [
      [await make.timeEntry({ ...at.place, billable: false }), 'not_billable'],
      [await make.timeEntry({ ...at.place, projectId: internal.id }), 'not_billable'],
      [await make.timeEntry({ ...at.place, personId: runner.id, timerStartedAt: new Date() }), 'running'],
      [await make.timeEntry({ ...at.place, billedOutside: true }), 'billed_outside'],
      [await make.timeEntry(elsewhere.place), 'other_client'],
      [{ id: 999_999, version: 1 }, 'not_found'],
    ] as const
    const goodCost = await make.expense(cost)
    const badCosts = [
      [await make.expense({ ...cost, billable: false }), 'not_billable'],
      [await make.expense({ ...cost, projectId: internal.id }), 'not_billable'],
      [await make.expense({ ...cost, billedOutside: true }), 'billed_outside'],
      [await make.expense({ ...cost, currency: 'EUR' }), 'other_currency'],
      [await make.expense({ ...elsewhere.place, categoryId: category.id }), 'other_client'],
      [{ ...goodCost }, 'duplicate'],
    ] as const
    const before = await everything()
    const attempt = bill([good, ...bad.map(([entry]) => entry)], {
      expenses: [goodCost, ...badCosts.map(([expense]) => expense)].map(({ id, version }) => ({ id, version })),
    })
    expect(await problemsOf(attempt)).toEqual(
      expect.arrayContaining([
        ...bad.map(([{ id }, reason]) => ({ kind: 'time', id, reason })),
        ...badCosts.map(([{ id }, reason]) => ({ kind: 'expense', id, reason })),
      ]),
    )
    expect(await everything()).toBe(before)
    await bill([good])
  })

  it('refuses an invoice in a currency other than the client’s, and nothing at all', async () => {
    const entry = await make.timeEntry(at.place)
    invoice = { ...invoice, currency: 'EUR' }
    expect(await problemsOf(bill([entry]))).toEqual([{ kind: 'time', id: entry.id, reason: 'other_currency' }])
    await expectProblem(bill([]), 'nothing_to_bill')
  })

  it('locks rows in the agreed order', async () => {
    const statements: string[] = []
    const { db } = database
    // Drizzle passes every statement to the driver through the session.
    const session = (db as unknown as { session: { prepareQuery: (query: { sql: string }) => unknown } }).session
    const prototype = Object.getPrototypeOf(session) as typeof session
    const original = prototype.prepareQuery
    const spy = vi.spyOn(prototype, 'prepareQuery').mockImplementation(function (this: unknown, ...args) {
      statements.push(args[0].sql)
      return original.apply(this, args)
    })
    const category = await make.category()
    const [second, first] = [await make.timeEntry(at.place), await make.timeEntry(at.place)]
    const expense = await make.expense({ ...at.place, categoryId: category.id })
    statements.length = 0
    await bill([first, second], { expenses: [{ id: expense.id, version: 1 }] })
    spy.mockRestore()
    const locks = statements
      .map((statement) => /from "(\w+)".*for update/.exec(statement)?.[1])
      .filter((table) => table !== undefined)
    expect(locks).toEqual(['number_sequences', 'time_entries', 'expenses'])
    for (const statement of statements.filter((text) => /from "(time_entries|expenses)".*for update/.test(text))) {
      expect(statement).toMatch(/order by "\w+"."id" asc for update/)
    }
  })
})

describe('the edit guard', () => {
  const guard = (id: number, version: number) => runTransaction(database.db, (tx) => lockTimeEntryForEdit(tx, id, version))
  const refusal = (action: Promise<unknown>) =>
    action.then(
      () => 'allowed',
      (error: unknown) => (error instanceof EntryLockedError ? error.reason : (error as Error).name),
    )

  it('gives each refusal its own reason', async () => {
    const entry = await make.timeEntry(at.place)
    expect(await refusal(guard(entry.id, 1))).toBe('allowed')
    expect(await refusal(guard(entry.id, 2))).toBe('StaleError')
    expect(await refusal(guard(999_999, 1))).toBe('NotFoundError')
    const approved = await make.timeEntry({ ...at.place, status: 'approved' })
    expect(await refusal(guard(approved.id, 1))).toBe('approved')
    await bill([entry])
    expect(await refusal(guard(entry.id, 1))).toBe('invoiced')
  })

  it('works alike for expenses', async () => {
    const guardExpense = (id: number, version: number) =>
      runTransaction(database.db, (tx) => lockExpenseForEdit(tx, id, version))
    const category = await make.category()
    const expense = await make.expense({ ...at.place, categoryId: category.id })
    expect(await refusal(guardExpense(expense.id, 1))).toBe('allowed')
    expect(await refusal(guardExpense(expense.id, 2))).toBe('StaleError')
    const approved = await make.expense({ ...at.place, categoryId: category.id, status: 'approved' })
    expect(await refusal(guardExpense(approved.id, 1))).toBe('approved')
    await bill([], { expenses: [{ id: expense.id, version: 1 }] })
    expect(await refusal(guardExpense(expense.id, 1))).toBe('invoiced')
  })
})

describe('deleting an invoice', () => {
  it('releases its entries and expenses', async () => {
    const entries = [await make.timeEntry(at.place), await make.timeEntry(at.place)]
    const category = await make.category()
    const expense = await make.expense({ ...at.place, categoryId: category.id })
    const more = { expenses: [{ id: expense.id, version: 1 }] }
    const made = await bill(entries, more)
    await expect(deleteInvoice(database.db, made.id, made.version + 1)).rejects.toBeInstanceOf(StaleError)
    await deleteInvoice(database.db, made.id, made.version)
    expect(await invoiceOf(made.id)).toBeUndefined()
    expect(await linesOf(made.id)).toEqual([])
    const again = await bill(entries, more)
    expect(again.total).toBe(made.total)
    expect(again.number).not.toBe(made.number)
    await expect(deleteInvoice(database.db, made.id, 1)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('is refused with payments, changing nothing', async () => {
    const made = await openInvoice()
    await recordPayment(database.db, pay(made.id, 1000))
    const before = await everything()
    const now = await invoiceOf(made.id)
    await expectProblem(deleteInvoice(database.db, made.id, now?.version ?? 0), 'invoice_has_payments')
    expect(await everything()).toBe(before)
  })

  it('leaves an estimate it was made from', async () => {
    const made = await bill([await make.timeEntry(at.place)])
    await database.db.execute(sql`insert into estimates (number, client_id, currency, issued_on, created_by, invoice_id)
      values (${`E ${made.id}`}, ${at.client.id}, 'USD', '2026-01-01', ${at.person.id}, ${made.id})`)
    await deleteInvoice(database.db, made.id, made.version)
  })
})

const pay = (invoiceId: number, amount: number) => ({ invoiceId, amount, paidOn: '2026-05-05', method: 'check' as const })

/** An open invoice over 10000. */
async function openInvoice() {
  const made = await bill([await make.timeEntry(at.place)])
  const [opened] = await database.db.update(invoices).set({ status: 'open' }).where(eq(invoices.id, made.id)).returning()
  if (!opened) throw new Error('No invoice')
  return opened
}

describe('payments', () => {
  it('set the invoice to paid when nothing is due, and a refund opens it again', async () => {
    const { id } = await openInvoice()
    const partly = await recordPayment(database.db, pay(id, 4000))
    expect(partly.invoice).toMatchObject({ status: 'open', paidAmount: 4000, dueAmount: 6000, paidOn: null })
    const full = await recordPayment(database.db, pay(id, 6000))
    expect(full.invoice).toMatchObject({ status: 'paid', paidAmount: 10_000, dueAmount: 0, paidOn: '2026-05-05' })
    const refund = { paymentId: full.payment.id, amount: 2500, refundedOn: '2026-05-06' }
    const refunded = await recordRefund(database.db, refund)
    expect(refunded.invoice).toMatchObject({ status: 'open', paidAmount: 7500, dueAmount: 2500, paidOn: null })
    await expectProblem(recordRefund(database.db, { ...refund, amount: 3501 }), 'refund_exceeds_payment')
    await expectProblem(recordRefund(database.db, { ...refund, amount: 0 }), 'amount_not_positive')
    await expect(recordRefund(database.db, { ...refund, paymentId: 999_999 })).rejects.toBeInstanceOf(NotFoundError)
    expect((await recordPayment(database.db, pay(id, 2500))).invoice.status).toBe('paid')
  })

  it('are refused above the amount due, and on draft, paid and closed invoices', async () => {
    const draft = await bill([await make.timeEntry(at.place)])
    const open = await openInvoice()
    const closed = await openInvoice()
    await database.db.update(invoices).set({ status: 'closed' }).where(eq(invoices.id, closed.id))
    const before = await everything()
    await expectProblem(recordPayment(database.db, pay(draft.id, 1)), 'invoice_not_payable')
    await expectProblem(recordPayment(database.db, pay(closed.id, 1)), 'invoice_not_payable')
    await expectProblem(recordPayment(database.db, pay(open.id, 10_001)), 'payment_exceeds_due')
    for (const amount of [0, -1, 0.5, NaN]) {
      await expectProblem(recordPayment(database.db, pay(open.id, amount)), 'amount_not_positive')
    }
    await expect(recordPayment(database.db, pay(999_999, 1))).rejects.toBeInstanceOf(NotFoundError)
    expect(await everything()).toBe(before)
    await recordPayment(database.db, pay(open.id, 10_000))
    await expectProblem(recordPayment(database.db, pay(open.id, 1)), 'payment_exceeds_due')
  })

  it('follow a change of lines', async () => {
    const { id } = await openInvoice()
    await recordPayment(database.db, pay(id, 4000))
    const addLine = (amount: number) =>
      runTransaction(database.db, (tx) =>
        changeInvoiceLines(tx, id, async () => {
          await tx.insert(invoiceLines).values({
            invoiceId: id, position: 9, kind: 'manual', quantity: 1000, unitPrice: amount, amount: 0,
          })
        }),
      )
    expect(await addLine(500)).toMatchObject({ status: 'open', total: 10_500, dueAmount: 6500 })
    expect((await linesOf(id)).map(({ amount }) => amount)).toEqual([10_000, 500])
    expect(await addLine(-6500)).toMatchObject({ status: 'paid', total: 4000, dueAmount: 0, paidOn: '2026-05-05' })
    await expectProblem(addLine(1), 'invoice_not_editable')
  })
})
