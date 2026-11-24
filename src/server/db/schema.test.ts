import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type SQL, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectRoot } from '../paths'
import { type Make, makeRecords } from '../testing/records'
import { createTestDatabase, queryRows, sqlState } from '../testing/testDatabase'
import type { Database } from '.'
import {
  assignments, companySettings, estimates, expenses, invoiceExpenses, invoiceLines, invoices, invoiceTimeEntries,
  itemCategories, numberSequences, payments, people, personCredentials, projects, roles, submissions, timeEntries,
  timeOffPolicies, timeOffRequests,
} from './schema'

let database: Database
let make: Make
beforeAll(async () => {
  database = await createTestDatabase()
  make = makeRecords(database.db)
})
afterAll(() => database.close())

const rows = <T>(query: SQL) => queryRows<T>(database.db, query)
const names = async (query: SQL) => (await rows<{ name: string }>(query)).map(({ name }) => name)
const allTables = () => names(sql`select tablename as name from pg_tables where schemaname = 'public' order by 1`)

describe('catalogue', () => {
  it('gives every table a primary key', async () => {
    const without = await names(sql`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p')`)
    expect(without).toEqual([])
    expect((await allTables()).length).toBeGreaterThan(80)
  })

  it('gives every foreign key an index that starts with its columns', async () => {
    const without = await names(sql`
      select conrelid::regclass || '.' || conname as name from pg_constraint k
      where contype = 'f' and connamespace = 'public'::regnamespace and not exists (
        select 1 from pg_index i
        where i.indrelid = k.conrelid and i.indpred is null
          and (select array_agg(column_number order by column_number)
               from unnest((i.indkey::int2[])[0:cardinality(k.conkey) - 1]) as column_number)
            = (select array_agg(column_number order by column_number) from unnest(k.conkey) as column_number))`)
    expect(without).toEqual([])
    const keys = await names(sql`
      select conname as name from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`)
    expect(keys.length).toBeGreaterThan(100)
  })

  it('has no floating-point or decimal column', async () => {
    const inexact = await names(sql`
      select table_name || '.' || column_name as name from information_schema.columns
      where table_schema = 'public' and data_type in ('real', 'double precision', 'numeric', 'money')`)
    expect(inexact).toEqual([])
  })

  it('stores business dates as date and instants with a time zone', async () => {
    const wrong = await names(sql`
      select table_name || '.' || column_name as name from information_schema.columns
      where table_schema = 'public' and (data_type = 'timestamp without time zone'
        or (column_name like '%\\_on' and data_type <> 'date')
        or (column_name like '%\\_at' and data_type <> 'timestamp with time zone'))
        and column_name not in ('week_starts_on')`)
    expect(wrong).toEqual([])
  })

  it('keeps secrets only in columns named as hash or ciphertext', async () => {
    const secrets = await names(sql`
      select column_name as name from information_schema.columns where table_schema = 'public'
        and (column_name like '%password%' or column_name like '%token%' or column_name like '%secret%')`)
    for (const name of secrets) expect(name).toMatch(/_(hash|ciphertext)$/)
    expect(secrets.length).toBeGreaterThan(5)
  })
})

describe('docs/data-model.md', () => {
  it('lists every table and no other', async () => {
    const text = await readFile(join(projectRoot, 'docs', 'data-model.md'), 'utf8')
    const section = /\n## Tables\n(.*?)(?=\n## )/s.exec(text)?.[1] ?? ''
    const listed = [...section.matchAll(/^\| `(\w+)` \| (.+) \| ([\d, ]+) \|$/gm)].map((match) => match[1])
    expect(listed.length).toBe(new Set(listed).size)
    expect([...listed].sort()).toEqual(await allTables())
    // Every table row has a purpose and tasks.
    expect(section.match(/^\| `/gm)).toHaveLength(listed.length)
  })

  it('maps every task of the coverage table to listed tables', async () => {
    const text = await readFile(join(projectRoot, 'docs', 'data-model.md'), 'utf8')
    const section = /\n## Coverage\n(.*?)(?=\n## |$)/s.exec(text)?.[1] ?? ''
    const tables = await allTables()
    const covered = [...section.matchAll(/^\| (\d{3}) \| [^|]+ \| ([^|]+) \|$/gm)]
    for (const [, , cell = ''] of covered) {
      const named = [...cell.matchAll(/`(\w+)(?:\.\w+)?`/g)].map((match) => match[1])
      expect(named.length).toBeGreaterThan(0)
      for (const name of named) expect(tables).toContain(name)
    }
    const tasks = new Set(covered.map(([, task]) => task))
    const expected = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25]
    expect([...tasks].sort()).toEqual(expected.map((task) => String(task).padStart(3, '0')))
  })
})

describe('reference data', () => {
  it('is created by the migrations', async () => {
    const { db } = database
    const fresh = await createTestDatabase()
    try {
      const created = await fresh.db.select().from(roles)
      expect(created.map(({ key, name, builtIn, permissions }) => ({ key, name, builtIn, permissions }))).toEqual([
        { key: 'administrator', name: 'Administrator', builtIn: true, permissions: [] },
        { key: 'manager', name: 'Manager', builtIn: true, permissions: [] },
        { key: 'member', name: 'Member', builtIn: true, permissions: [] },
      ])
      for (const table of await allTables()) {
        const [row] = await queryRows<{ n: number }>(fresh.db, sql`select count(*)::int as n from ${sql.identifier(table)}`)
        const expected = { roles: 3, company_settings: 1, number_sequences: 2, item_categories: 2 }[table] ?? 0
        expect([table, row?.n]).toEqual([table, expected])
      }
    } finally {
      await fresh.close()
    }
    expect(await db.select().from(companySettings)).toMatchObject([
      { name: 'JET Engineering', currency: 'USD', weekStartsOn: 1, timeZone: 'America/Chicago' },
    ])
    expect((await db.select().from(numberSequences)).map(({ kind }) => kind).sort()).toEqual(['estimate', 'invoice'])
    expect((await db.select().from(itemCategories)).map(({ name }) => name)).toEqual(['Service', 'Product'])
  })
})

const check = '23514'
const duplicate = '23505'
const missing = '23502'
const reference = '23503'

describe('rules the database enforces', () => {
  it('limits the minutes of an entry', async () => {
    const { place } = await make.workplace()
    expect(await sqlState(make.timeEntry({ ...place, minutes: -1 }))).toBe(check)
    expect(await sqlState(make.timeEntry({ ...place, minutes: 1441 }))).toBe(check)
    await make.timeEntry({ ...place, minutes: 1440 })
    await make.timeEntry({ ...place, minutes: 0 })
    expect(await sqlState(make.timeEntry({ ...place, startMinute: 60 }))).toBe(check)
    expect(await sqlState(make.timeEntry({ ...place, startMinute: 60, endMinute: 59 }))).toBe(check)
    await make.timeEntry({ ...place, startMinute: 60, endMinute: 120 })
  })

  it('knows the statuses, types, rate methods and budget types', async () => {
    const { person, client, place } = await make.workplace()
    const bogus = 'bogus' as never
    const category = await make.category()
    const attempts = [
      make.person({ status: bogus }),
      make.person({ kind: bogus }),
      make.project({ clientId: client.id, type: bogus }),
      make.project({ clientId: client.id, rateMethod: bogus }),
      make.project({ clientId: client.id, budgetType: bogus }),
      make.timeEntry({ ...place, status: bogus }),
      make.expense({ ...place, categoryId: category.id, status: bogus }),
      make.expense({ ...place, categoryId: category.id, reimbursable: true, reimbursementStatus: bogus }),
      make.invoice({ clientId: client.id, createdBy: person.id, status: bogus }),
      make.client({ paymentTerms: bogus }),
      make.client({ currency: 'usd' }),
      make.client({ tax1Percent: 100_001 }),
    ]
    for (const attempt of attempts) expect(await sqlState(attempt)).toBe(check)
  })

  it('checks the value of every status, type, kind and method column', async () => {
    const columns = await names(sql`
      select table_name || '.' || column_name as name from information_schema.columns
      where table_schema = 'public' and data_type = 'text'
        and column_name in ('status', 'type', 'rate_method', 'budget_type', 'method', 'frequency', 'visibility',
          'payment_terms', 'reimbursement_status', 'accrual_method', 'answer')`)
    const checks = await names(sql`
      select conrelid::regclass || '.' || conname as name from pg_constraint where contype = 'c'`)
    expect(columns.length).toBeGreaterThan(20)
    for (const column of columns) {
      const [table, name] = column.split('.')
      expect(checks).toContain(`${table}.${table}_${name}_check`)
    }
  })

  it('treats emails as equal whatever their case', async () => {
    await make.person({ email: 'Same@jet.example' })
    expect(await sqlState(make.person({ email: 'sAME@JET.example' }))).toBe(duplicate)
  })

  it('allows one running timer per person', async () => {
    const { place } = await make.workplace()
    await make.timeEntry({ ...place, timerStartedAt: new Date() })
    expect(await sqlState(make.timeEntry({ ...place, timerStartedAt: new Date() }))).toBe(duplicate)
    const other = await make.person()
    await make.timeEntry({ ...place, personId: other.id, timerStartedAt: new Date() })
    expect(await sqlState(make.timeEntry({ ...place, status: 'approved', timerStartedAt: new Date() }))).toBe(check)
  })

  it('requires a person and a project', async () => {
    const { place } = await make.workplace()
    const category = await make.category()
    const none = null as never
    expect(await sqlState(make.timeEntry({ ...place, personId: none, createdBy: place.personId }))).toBe(missing)
    expect(await sqlState(make.timeEntry({ ...place, projectId: none }))).toBe(missing)
    const expense = { ...place, categoryId: category.id }
    expect(await sqlState(make.expense({ ...expense, personId: none, createdBy: place.personId }))).toBe(missing)
    expect(await sqlState(make.expense({ ...expense, projectId: none }))).toBe(missing)
    expect(await sqlState(make.timeEntry({ ...place, taskId: 999_999 }))).toBe(reference)
    expect(await sqlState(make.expense({ ...expense, projectId: 999_999 }))).toBe(reference)
  })

  it('refuses a document number twice', async () => {
    const { person, client } = await make.workplace()
    const invoice = { clientId: client.id, createdBy: person.id, number: 'A-1' }
    await make.invoice(invoice)
    expect(await sqlState(make.invoice(invoice))).toBe(duplicate)
    const estimate = { ...invoice, currency: 'USD', issuedOn: '2026-01-01' }
    await database.db.insert(estimates).values(estimate)
    expect(await sqlState(database.db.insert(estimates).values(estimate))).toBe(duplicate)
  })

  it('refuses totals that do not add up', async () => {
    const { person, client } = await make.workplace()
    const invoice = { clientId: client.id, createdBy: person.id }
    expect(await sqlState(make.invoice({ ...invoice, subtotal: 100, total: 101, dueAmount: 101 }))).toBe(check)
    expect(await sqlState(make.invoice({ ...invoice, subtotal: 100, total: 100, dueAmount: 99 }))).toBe(check)
  })

  it('refuses a billed entry or expense on a second line', async () => {
    const { db } = database
    const { person, client, place } = await make.workplace()
    const category = await make.category()
    const entry = await make.timeEntry(place)
    const expense = await make.expense({ ...place, categoryId: category.id })
    const invoice = await make.invoice({ clientId: client.id, createdBy: person.id })
    const lines = await db
      .insert(invoiceLines)
      .values([1, 2].map((position) => ({
        invoiceId: invoice.id, position, kind: 'manual' as const, quantity: 0, unitPrice: 0, amount: 0,
      })))
      .returning()
    const time = lines.map(({ id }) => ({ timeEntryId: entry.id, lineId: id, minutes: 60, rate: 1, amount: 1 }))
    const costs = lines.map(({ id }) => ({ expenseId: expense.id, lineId: id, amount: 1 }))
    await db.insert(invoiceTimeEntries).values(time.slice(0, 1))
    expect(await sqlState(db.insert(invoiceTimeEntries).values(time.slice(1)))).toBe(duplicate)
    await db.insert(invoiceExpenses).values(costs.slice(0, 1))
    expect(await sqlState(db.insert(invoiceExpenses).values(costs.slice(1)))).toBe(duplicate)

    // And neither can be deleted.
    expect(await sqlState(db.delete(timeEntries).where(sql`id = ${entry.id}`))).toBe(reference)
    expect(await sqlState(db.delete(expenses).where(sql`id = ${expense.id}`))).toBe(reference)
  })

  it('accepts only positive payments, and a provider reference once', async () => {
    const { db } = database
    const { person, client } = await make.workplace()
    const invoice = await make.invoice({ clientId: client.id, createdBy: person.id })
    const payment = { invoiceId: invoice.id, paidOn: '2026-05-01', method: 'check' as const }
    expect(await sqlState(db.insert(payments).values({ ...payment, amount: 0 }))).toBe(check)
    expect(await sqlState(db.insert(payments).values({ ...payment, amount: -1 }))).toBe(check)
    const online = { ...payment, amount: 1, method: 'online' as const, provider: 'simulated', providerReference: 'x1' }
    await db.insert(payments).values(online)
    expect(await sqlState(db.insert(payments).values(online))).toBe(duplicate)
    expect(await sqlState(db.insert(payments).values({ ...online, provider: null }))).toBe(check)
    expect(await sqlState(db.insert(payments).values({ ...online, providerReference: null }))).toBe(check)
    expect(await sqlState(db.delete(invoices).where(sql`id = ${invoice.id}`))).toBe(reference)
  })

  it('refuses an end date before the start date', async () => {
    const { db } = database
    const { person, client, project } = await make.workplace()
    const dates = { startsOn: '2026-03-02', endsOn: '2026-03-01' }
    expect(await sqlState(make.project({ clientId: client.id, ...dates }))).toBe(check)
    await make.project({ clientId: client.id, startsOn: '2026-03-02', endsOn: '2026-03-02' })
    const [policy] = await db
      .insert(timeOffPolicies)
      .values({ name: 'Policy', kind: 'vacation', paid: true, accrualMethod: 'none' })
      .returning()
    const request = { policyId: policy?.id ?? 0, personId: person.id, minutesPerDay: 480, ...dates }
    expect(await sqlState(db.insert(timeOffRequests).values(request))).toBe(check)
    const assignment = { projectId: project.id, personId: person.id, minutesPerDay: 480, ...dates }
    expect(await sqlState(db.insert(assignments).values(assignment))).toBe(check)
  })

  it('allows one weekly submission per person and period', async () => {
    const person = await make.person()
    const submission = {
      personId: person.id, periodStart: '2026-03-02', periodEnd: '2026-03-08', status: 'submitted' as const,
    }
    await database.db.insert(submissions).values(submission)
    expect(await sqlState(database.db.insert(submissions).values(submission))).toBe(duplicate)
  })

  it('allows one company-settings record', async () => {
    expect(await sqlState(database.db.insert(companySettings).values({ id: 1 }))).toBe(duplicate)
    expect(await sqlState(database.db.insert(companySettings).values({ id: 2 }))).toBe(check)
  })

  it('does not delete what others depend on', async () => {
    const { db } = database
    const { person, client, project, projectTask, place } = await make.workplace()
    expect(await sqlState(db.execute(sql`delete from clients where id = ${client.id}`))).toBe(reference)
    const entry = await make.timeEntry(place)
    expect(await sqlState(db.execute(sql`delete from projects where id = ${project.id}`))).toBe(reference)
    expect(await sqlState(db.execute(sql`delete from people where id = ${person.id}`))).toBe(reference)
    expect(await sqlState(db.execute(sql`delete from project_tasks where id = ${projectTask.id}`))).toBe(reference)
    await db.execute(sql`delete from time_entries where id = ${entry.id}`)
    await db.delete(projects).where(sql`id = ${project.id}`)
  })

  it('deletes what belongs to a person with them', async () => {
    const person = await make.person()
    await database.db.insert(personCredentials).values({ personId: person.id, passwordHash: 'x' })
    await database.db.delete(people).where(sql`id = ${person.id}`)
    expect(await database.db.select().from(personCredentials)).toEqual([])
  })
})
