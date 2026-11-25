import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { documentTotals, expenseAmount, resolveBillableRate, timeAmount } from '../../shared/calc'
import { addDays, type IsoDate } from '../../shared/dates'
import { budgetTypes, projectTypes, rateMethods, reimbursementStatuses, timeOffStatuses } from '../../shared/domain'
import { problemWith, roleGrants } from '../../shared/permissions'
import { createInvoiceFromEntries } from '../billing'
import type { Database } from '../db'
import * as schema from '../db/schema'
import { verifyPassword } from '../security/passwords'
import { makeRecords } from '../testing/records'
import { createTestDatabase, queryRows } from '../testing/testDatabase'
import { datesBetween, isWeekday } from './builder'
import { demoSeedDate, resetDemo, seedDemo } from '.'

const dates: [string, IsoDate][] = [
  ['New Year', '2026-01-01'],
  ['a leap day', '2028-02-29'],
  ['a Monday', '2026-11-23'],
  ['a Sunday', '2026-11-22'],
  ['the last day of a year', '2026-12-31'],
]

describe.each(dates)('demo data for %s', (_name, today) => {
  let database: Database
  let data: Awaited<ReturnType<typeof load>>
  beforeAll(async () => {
    database = await createTestDatabase()
    const begin = Date.now()
    expect(await seedDemo(database.db, { today })).toBe(today)
    expect(Date.now() - begin).toBeLessThan(60_000)
    data = await load(database)
  }, 60_000)
  afterAll(() => database.close())

  const monday = (() => {
    let date = today
    while (new Date(`${date}T00:00:00Z`).getUTCDay() !== 1) date = addDays(date, -1)
    return date
  })()
  const person = (email: string) => find(data.people, (row) => row.email === email)
  const lead = () => person('lead@jet.demo')
  const employee = () => person('employee@jet.demo')
  const active = () => data.people.filter(({ status }) => status === 'active')
  const clientOf = (projectId: number) =>
    find(data.clients, ({ id }) => id === find(data.projects, (project) => project.id === projectId).clientId)

  it('marks the database as demo data', async () => {
    expect(await demoSeedDate(database.db)).toBe(today)
  })

  it('has the people', async () => {
    expect(data.people).toHaveLength(11)
    const count = (status: string) => data.people.filter((row) => row.status === status).length
    expect([count('active'), count('archived'), count('pending')]).toEqual([9, 1, 1])
    expect(active().some(({ kind }) => kind === 'contractor')).toBe(true)
    const role = (email: string) => find(data.roles, ({ id }) => id === person(email).roleId).name
    expect(['admin', 'lead', 'employee'].map((name) => role(`${name}@jet.demo`))).toEqual([
      'Administrator', 'Manager', 'Member',
    ])
    for (const { email, phone } of data.people) {
      expect(email).toMatch(/^(admin|lead|employee)@jet\.demo$|\.example$/)
      expect(phone).toMatch(/555-01\d\d$/)
    }
    for (const { email, officePhone, mobilePhone } of data.contacts) {
      expect(email).toMatch(/\.example$/)
      for (const phone of [officePhone, mobilePhone]) if (phone) expect(phone).toMatch(/555-01\d\d$/)
    }
    // The lead's extras, and the one custom role, held by one person who is not a demo account.
    expect(data.extras.map(({ personId, permission }) => [personId, permission]).sort()).toEqual(
      ['billable.view', 'projects.create', 'time.approve'].map((permission) => [lead().id, permission]),
    )
    const custom = data.roles.filter(({ builtIn }) => !builtIn)
    expect(custom).toMatchObject([{ name: 'Bookkeeper', key: null }])
    expect([...(custom[0]?.permissions ?? [])].sort()).toEqual([
      'billable.view:all', 'clients.view:all', 'expenses.reimburse:all', 'invoices.manage:all', 'payments.manage:all', 'time.view:all',
    ])
    expect(problemWith(roleGrants(custom[0] ?? { key: null, builtIn: false, permissions: [] }))).toBeNull()
    const keepers = data.people.filter(({ roleId }) => roleId === custom[0]?.id)
    expect(keepers.map(({ status, email }) => [status, email.endsWith('@jet.demo')])).toEqual([['active', false]])
    const demo = active().filter(({ email }) => email.endsWith('@jet.demo'))
    expect(data.credentials.map(({ personId }) => personId).sort()).toEqual(demo.map(({ id }) => id).sort())
    expect(new Set(data.credentials.map(({ passwordHash }) => passwordHash)).size).toBe(3)
    for (const { passwordHash } of data.credentials) {
      expect(passwordHash).toMatch(/^\$scrypt\$/)
      expect(await verifyPassword('jetdemo123', passwordHash)).toBe(true)
      expect(await verifyPassword('jetdemo124', passwordHash)).toBe(false)
    }
  })

  it('has the clients, projects and tasks', () => {
    expect(data.clients).toHaveLength(6)
    const open = data.clients.filter(({ archivedAt }) => archivedAt === null)
    expect(open).toHaveLength(5)
    const foreign = data.clients.filter(({ currency }) => currency !== 'USD')
    expect(foreign.length).toBeGreaterThan(0)
    for (const { currency } of foreign) expect(data.exchangeRates.some((rate) => rate.fromCurrency === currency)).toBe(true)
    expect(data.clients.some(({ id }) => !data.invoices.some(({ clientId }) => clientId === id))).toBe(true)
    expect(data.clients.filter(({ tax1Percent }) => tax1Percent !== null).length).toBeGreaterThan(1)
    for (const { id } of open) expect(data.contacts.some(({ clientId }) => clientId === id)).toBe(true)

    expect(data.projects.length).toBeGreaterThanOrEqual(10)
    const used = <K extends 'type' | 'rateMethod' | 'budgetType'>(key: K) => new Set(data.projects.map((row) => row[key]))
    expect(used('type')).toEqual(new Set(projectTypes))
    expect(used('rateMethod')).toEqual(new Set(rateMethods))
    expect(used('budgetType')).toEqual(new Set(budgetTypes))
    expect(data.projects.some(({ budgetMonthly }) => budgetMonthly)).toBe(true)
    expect(data.projects.some(({ budgetIncludesExpenses }) => budgetIncludesExpenses)).toBe(true)
    expect(data.projects.some(({ budgetVisibleToAll }) => budgetVisibleToAll)).toBe(true)
    expect(data.projects.some(({ archivedAt }) => archivedAt !== null)).toBe(true)

    expect(data.tasks.length).toBeGreaterThanOrEqual(8)
    expect(data.tasks.some(({ common }) => common)).toBe(true)
    expect(data.tasks.some(({ billableByDefault }) => !billableByDefault)).toBe(true)
    expect(data.tasks.some(({ archivedAt }) => archivedAt !== null)).toBe(true)
  })

  it('has one project over budget and one past its alert', () => {
    const share = data.projects.map((project) => {
      const entries = data.time.filter(({ projectId }) => projectId === project.id)
      if (project.budgetMonthly) return 0
      if (project.budgetType === 'total_hours') {
        return entries.reduce((sum, { minutes }) => sum + minutes, 0) / (project.budgetMinutes ?? 1)
      }
      if (project.budgetType !== 'total_fees') return 0
      let used = entries.reduce((sum, entry) => {
        const rate = rateOf(data, entry)
        return sum + (rate === null ? 0 : timeAmount(entry.minutes, rate))
      }, 0)
      if (project.budgetIncludesExpenses) {
        used += data.expenses.filter(({ projectId }) => projectId === project.id).reduce((sum, { amount }) => sum + amount, 0)
      }
      return used / (project.budgetAmount ?? 1)
    })
    expect(share.filter((used) => used > 1)).toHaveLength(1)
    const pastAlert = share.filter((used, index) => {
      const alert = data.projects[index]?.budgetAlertPercent
      return alert !== null && alert !== undefined && used * 100_000 >= alert && used <= 1
    })
    expect(pastAlert).toHaveLength(1)
  })

  it('gives the lead projects and people, and the employee work', () => {
    const open = new Set(data.projects.filter(({ archivedAt }) => archivedAt === null).map(({ id }) => id))
    const managed = data.members.filter((row) => row.personId === lead().id && row.isManager && open.has(row.projectId))
    expect(managed.length).toBeGreaterThanOrEqual(2)
    expect(data.managers.filter(({ managerId }) => managerId === lead().id).length).toBeGreaterThanOrEqual(3)
    const own = data.members.filter((row) => row.personId === employee().id && open.has(row.projectId))
    expect(own.length).toBeGreaterThanOrEqual(3)
    const shared = own.filter(({ projectId }) => managed.some((row) => row.projectId === projectId))
    expect(shared.length).toBeGreaterThanOrEqual(2)
  })

  it('has 26 weeks of time on at least 80% of working days', () => {
    const holidays = new Set(data.holidays.map(({ observedOn }) => observedOn))
    for (const { id } of active()) {
      const free = data.requests.filter((row) => row.personId === id && row.status === 'approved')
      const working = datesBetween(addDays(monday, -182), addDays(monday, -1)).filter(
        (date) =>
          isWeekday(date) && !holidays.has(date) && !free.some(({ startsOn, endsOn }) => startsOn <= date && date <= endsOn),
      )
      const totals = new Map<string, number>()
      for (const entry of data.time.filter(({ personId }) => personId === id)) {
        totals.set(entry.spentOn, (totals.get(entry.spentOn) ?? 0) + entry.minutes)
        if (entry.spentOn < monday) expect(working).toContain(entry.spentOn)
      }
      const days = working.filter((date) => totals.has(date))
      expect(days.length / working.length).toBeGreaterThanOrEqual(0.8)
      for (const total of totals.values()) {
        expect(total).toBeGreaterThanOrEqual(240)
        expect(total).toBeLessThanOrEqual(600)
      }
      for (let week = 1; week <= 26; week++) {
        const start = addDays(monday, -7 * week)
        const inWeek = (date: string) => date >= start && date <= addDays(start, 6)
        if (working.some(inWeek)) expect([id, start, days.some(inWeek)]).toEqual([id, start, true])
      }
    }
  })

  it('has only valid entries', () => {
    const members = new Set(data.members.map((row) => `${row.projectId}/${row.personId}`))
    const onProject = new Set(data.projectTasks.map((row) => `${row.projectId}/${row.taskId}`))
    const archived = find(data.people, ({ status }) => status === 'archived')
    for (const entry of [...data.time, ...data.expenses]) {
      expect(members.has(`${entry.projectId}/${entry.personId}`)).toBe(true)
      expect(entry.spentOn <= today).toBe(true)
      expect(entry.createdAt.getTime()).toBeLessThanOrEqual(Date.parse(`${addDays(today, 1)}T06:00:00Z`))
      expect(entry.notes.length).toBeGreaterThan(5)
      if (entry.personId === archived.id) expect(entry.spentOn <= (archived.archivedOn ?? '')).toBe(true)
      if (entry.spentOn >= monday) {
        expect(entry.status).toBe('unsubmitted')
        expect(entry.spentOn < today && isWeekday(entry.spentOn)).toBe(true)
      }
    }
    for (const entry of data.time) {
      expect(onProject.has(`${entry.projectId}/${entry.taskId}`)).toBe(true)
      expect(entry.timerStartedAt).toBeNull()
    }
    const free = new Set(data.holidays.map(({ observedOn }) => observedOn))
    const passed = datesBetween(monday, addDays(today, -1)).filter((date) => isWeekday(date) && !free.has(date))
    expect(new Set(data.time.filter(({ spentOn }) => spentOn >= monday).map(({ spentOn }) => spentOn))).toEqual(new Set(passed))
  })

  it('has approvals to do', () => {
    const lastMonday = addDays(monday, -7)
    const last = data.submissions.filter(({ periodStart }) => periodStart === lastMonday)
    const led = new Set(data.managers.filter(({ managerId }) => managerId === lead().id).map(({ personId }) => personId))
    const waiting = last.filter(({ status, personId }) => status === 'submitted' && led.has(personId) && personId !== employee().id)
    expect(waiting.length).toBeGreaterThanOrEqual(2)
    expect(last.find(({ personId }) => personId === employee().id)?.status).toBe('approved')
    const rejected = last.filter(({ status }) => status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.comment).not.toBe('')
    const absent = active().filter(({ id }) => !last.some(({ personId }) => personId === id))
    expect(absent.length).toBeGreaterThanOrEqual(1)

    // Each entry says the same as its week.
    for (const entry of [...data.time, ...data.expenses]) {
      const week = data.submissions.find(
        (row) => row.personId === entry.personId && row.periodStart <= entry.spentOn && entry.spentOn <= row.periodEnd,
      )
      expect(entry.status).toBe(week?.status ?? 'unsubmitted')
    }
    for (const { submittedAt, decidedAt } of data.submissions) {
      if (decidedAt) expect(decidedAt.getTime()).toBeGreaterThan(submittedAt.getTime())
    }

    const billed = new Set(data.timeLinks.map(({ timeEntryId }) => timeEntryId))
    const billedExpenses = new Set(data.expenseLinks.map(({ expenseId }) => expenseId))
    for (const { id, status } of data.time) if (billed.has(id)) expect(status).toBe('approved')
    for (const { id, status } of data.expenses) if (billedExpenses.has(id)) expect(status).toBe('approved')
    const unbilled = <T extends { id: number; projectId: number; billable: boolean; status: string }>(all: T[], done: Set<number>) =>
      new Set(
        all
          .filter((row) => row.billable && row.status === 'approved' && !done.has(row.id))
          .map(({ projectId }) => clientOf(projectId).id),
      )
    expect(unbilled(data.time, billed).size).toBeGreaterThanOrEqual(2)
    expect(unbilled(data.expenses, billedExpenses).size).toBeGreaterThanOrEqual(2)
  })

  it('has expenses with receipts that open', () => {
    expect(data.expenses.length).toBeGreaterThanOrEqual(60)
    const mileage = data.expenses.filter(({ quantity }) => quantity !== null)
    expect(mileage.length).toBeGreaterThan(0)
    for (const { quantity, unitPrice, amount } of mileage) expect(amount).toBe(expenseAmount(quantity ?? 0, unitPrice ?? 0))
    expect(new Set(data.expenses.map(({ billable }) => billable))).toEqual(new Set([true, false]))
    expect(new Set(data.expenses.map((row) => row.reimbursementStatus))).toEqual(new Set(reimbursementStatuses))
    expect(data.receipts.length).toBeGreaterThanOrEqual(5)
    expect(new Set(data.files.map(({ mediaType }) => mediaType))).toEqual(new Set(['image/png', 'application/pdf']))
    for (const { content, mediaType } of data.files) {
      const start = content.subarray(0, 8).toString('latin1')
      expect(start).toBe(mediaType === 'image/png' ? '\x89PNG\r\n\x1a\n' : '%PDF-1.4')
    }
  })

  it('has invoices in every state', () => {
    expect(data.invoices.length).toBeGreaterThanOrEqual(14)
    const open = data.invoices.filter(({ status }) => status === 'open')
    const late = (low: number, high: number) =>
      open.some(({ dueOn }) => addDays(dueOn, low) <= today && today <= addDays(dueOn, high))
    for (const [low, high] of [[1, 30], [31, 60], [61, 90], [91, 999]] as const) expect([low, late(low, high)]).toEqual([low, true])
    expect(open.some(({ dueOn }) => dueOn >= today)).toBe(true)
    expect(open.some(({ paidAmount }) => paidAmount > 0)).toBe(true)
    for (const status of ['draft', 'paid', 'closed']) expect(data.invoices.some((row) => row.status === status)).toBe(true)
    expect(data.writeOffs.length).toBeGreaterThan(0)
    expect(data.invoices.some(({ discountAmount }) => discountAmount > 0)).toBe(true)
    expect(data.invoices.some(({ tax1Amount, tax2Amount }) => tax1Amount > 0 && tax2Amount > 0)).toBe(true)
    const kinds = (id: number) => data.lines.filter(({ invoiceId }) => invoiceId === id).map(({ kind }) => kind)
    expect(data.invoices.some(({ id }) => kinds(id).every((kind) => kind === 'manual'))).toBe(true)
    expect(data.invoices.some(({ id }) => kinds(id).includes('retainer'))).toBe(true)
    expect(data.recurring.length).toBeGreaterThan(0)
    expect(data.ledger.reduce((sum, { amount }) => sum + amount, 0)).toBeGreaterThan(0)
    for (const { issuedOn } of data.invoices) expect(issuedOn <= today).toBe(true)
    for (const { provider, method, paidOn } of data.payments) {
      expect(paidOn <= today).toBe(true)
      expect(provider).toBe(method === 'online' ? 'simulated' : null)
    }
    expect(data.payments.some(({ method }) => method === 'online')).toBe(true)
    const numbers = data.invoices.map(({ number }) => number)
    expect([...numbers].sort()).toEqual(numbers)
    expect([...data.invoices].sort((a, b) => a.issuedOn.localeCompare(b.issuedOn)).map(({ number }) => number)).toEqual(numbers)
  })

  it('has figures that agree with the shared calculations', () => {
    const agree = (
      document: typeof schema.invoices.$inferSelect | typeof schema.estimates.$inferSelect,
      lines: (Parameters<typeof documentTotals>[0][number] & { amount: number })[],
    ) => {
      expect(lines.length).toBeGreaterThan(0)
      const totals = documentTotals(lines, document)
      expect(lines.map(({ amount }) => amount)).toEqual(totals.lineAmounts)
      expect(document).toMatchObject({
        subtotal: totals.subtotal, discountAmount: totals.discount, tax1Amount: totals.tax1, tax2Amount: totals.tax2,
        total: totals.total,
      })
    }
    for (const invoice of data.invoices) {
      agree(invoice, data.lines.filter(({ invoiceId }) => invoiceId === invoice.id).sort((a, b) => a.position - b.position))
      const paid = data.payments.filter(({ invoiceId }) => invoiceId === invoice.id).reduce((sum, { amount }) => sum + amount, 0)
      expect([invoice.paidAmount, invoice.dueAmount]).toEqual([paid, invoice.total - paid])
      expect(invoice.status === 'paid').toBe(invoice.dueAmount === 0)
    }
    for (const estimate of data.estimates) {
      agree(estimate, data.estimateLines.filter(({ estimateId }) => estimateId === estimate.id).sort((a, b) => a.position - b.position))
    }
    const entries = new Map(data.time.map((entry) => [entry.id, entry]))
    for (const link of data.timeLinks) {
      const entry = find([entries.get(link.timeEntryId)], () => true)
      expect(link.amount).toBe(timeAmount(link.minutes, link.rate))
      expect([link.minutes, link.rate]).toEqual([entry?.minutes, entry && rateOf(data, entry)])
    }
    const expenses = new Map(data.expenses.map((expense) => [expense.id, expense]))
    for (const { expenseId, amount } of data.expenseLinks) expect(amount).toBe(expenses.get(expenseId)?.amount)
    for (const line of data.lines.filter(({ kind }) => kind === 'time')) {
      const links = data.timeLinks.filter(({ lineId }) => lineId === line.id)
      expect(links.reduce((sum, { minutes }) => sum + minutes, 0)).toBe(line.minutes)
      for (const { rate } of links) expect(rate).toBe(line.unitPrice)
    }
    expect(data.timeLinks.length).toBeGreaterThan(500)
    expect(data.expenseLinks.length).toBeGreaterThan(10)
  })

  it('has estimates in every state', () => {
    expect(new Set(data.estimates.map(({ status }) => status))).toEqual(new Set(['draft', 'sent', 'accepted', 'declined']))
    const accepted = data.estimates.filter(({ status }) => status === 'accepted')
    expect(accepted.some(({ invoiceId }) => invoiceId !== null)).toBe(true)
    expect(accepted.some(({ projectId }) => projectId !== null)).toBe(true)
    expect(accepted.some(({ invoiceId, projectId }) => invoiceId === null && projectId === null)).toBe(true)
  })

  it('has everything else, dated around today', () => {
    const changes = new Map<number, number>()
    for (const { personId, kind } of data.rates) if (kind === 'billable') changes.set(personId, (changes.get(personId) ?? 0) + 1)
    expect([...changes.values()].filter((count) => count > 1).length).toBeGreaterThanOrEqual(2)

    expect(data.policies).toHaveLength(3)
    expect(new Set(data.requests.map(({ status }) => status))).toEqual(new Set(timeOffStatuses))
    for (const { id, kind } of data.policies.filter((policy) => policy.kind !== 'unpaid')) {
      for (const { id: personId } of active()) {
        const balance = data.timeOff
          .filter((row) => row.policyId === id && row.personId === personId)
          .reduce((sum, { minutes }) => sum + minutes, 0)
        expect([kind, balance > 0]).toEqual([kind, true])
      }
    }
    expect(data.calendars).toHaveLength(1)

    expect(data.assignments.map(({ startsOn }) => startsOn).sort()[0]).toBe(addDays(monday, -28))
    const ends = data.assignments.map(({ endsOn, repeatUntil }) => repeatUntil ?? endsOn).sort()
    expect(ends.at(-1)).toBe(addDays(monday, 60))
    expect(data.assignments.some(({ placeholderId }) => placeholderId !== null)).toBe(true)
    expect(data.milestones.some(({ dueOn }) => dueOn > today)).toBe(true)

    for (const email of ['admin@jet.demo', 'lead@jet.demo', 'employee@jet.demo']) {
      expect(data.notifications.some(({ personId }) => personId === person(email).id)).toBe(true)
    }
    expect(data.outbox.length).toBeGreaterThan(0)
    for (const { status, sentAt } of data.outbox) expect([status, sentAt]).toEqual(['captured', null])
    expect(data.reports).toHaveLength(1)
    expect(data.activity.length).toBeGreaterThanOrEqual(10)
  })

  it('claims nothing that has not happened yet', async () => {
    const tables = [
      'people', 'time_entries', 'expenses', 'submissions', 'invoices', 'payments', 'estimates', 'notifications',
      'outbox_messages', 'activity_log', 'invoice_messages', 'files',
    ]
    for (const table of tables) {
      const [row] = await queryRows<{ late: number }>(
        database.db,
        sql`select count(*)::int as late from ${sql.identifier(table)}
            where created_at > (${today}::date::timestamp at time zone 'America/Chicago')`,
      )
      expect([table, row?.late]).toEqual([table, 0])
    }
  })
})

describe('seeding', () => {
  let database: Database
  beforeAll(async () => {
    database = await createTestDatabase()
    await seedDemo(database.db, { today: '2026-11-23' })
  })
  afterAll(() => database.close())

  /** Every row of every table, without password hashes. */
  async function dump({ db }: Database) {
    const tables = await queryRows<{ name: string }>(
      db, sql`select tablename as name from pg_tables where schemaname = 'public' order by 1`,
    )
    const all: Record<string, string[]> = {}
    for (const { name } of tables) {
      const rows = await queryRows<{ row: Record<string, unknown> }>(
        db, sql`select to_jsonb(t) - 'password_hash' as row from ${sql.identifier(name)} t`,
      )
      all[name] = rows.map(({ row }) => JSON.stringify(row)).sort()
    }
    return all
  }

  it('gives the same records again, also after changes and a reset', async () => {
    const first = await dump(database)
    const other = await createTestDatabase()
    await new Promise((resolve) => setTimeout(resolve, 1100)) // Another time of day.
    await seedDemo(other.db, { today: '2026-11-23' })
    expect(await dump(other)).toEqual(first)

    await makeRecords(other.db).workplace()
    await other.db.update(schema.companySettings).set({ name: 'Changed', signUpEnabled: false })
    await other.db.update(schema.roles).set({ permissions: ['x'] }).where(eq(schema.roles.key, 'member'))
    await other.db.update(schema.itemCategories).set({ name: 'Goods' }).where(eq(schema.itemCategories.name, 'Product'))
    await resetDemo(other.db, { today: '2026-11-23' })
    expect(await dump(other)).toEqual(first)
    await other.close()
  }, 60_000)

  it('leaves every generated key free', async () => {
    const columns = await queryRows<{ table: string; column: string }>(
      database.db,
      sql`select table_name as "table", column_name as "column" from information_schema.columns
          where table_schema = 'public' and is_identity = 'YES'`,
    )
    expect(columns.length).toBeGreaterThan(50)
    for (const { table, column } of columns) {
      const [row] = await queryRows<{ next: number; used: number }>(
        database.db,
        sql`select nextval(pg_get_serial_sequence(${table}, ${column}))::int as next,
                   (select coalesce(max(${sql.identifier(column)}), 0) from ${sql.identifier(table)}) as used`,
      )
      expect([table, (row?.next ?? 0) > (row?.used ?? 0)]).toEqual([table, true])
    }
  })

  it('leaves a database that can be worked with', async () => {
    const make = makeRecords(database.db)
    const { person, client, place } = await make.workplace()
    const entry = await make.timeEntry(place)
    const category = await make.category()
    await make.expense({ ...place, categoryId: category.id })
    const invoice = await createInvoiceFromEntries(
      database.db,
      { clientId: client.id, createdBy: person.id, currency: 'USD', issuedOn: '2026-11-23', dueOn: '2026-12-23' },
      { timeEntries: [entry], expenses: [] },
    )
    expect(invoice.number).toBe('INV-0028')
  })
})

describe('all or nothing', () => {
  const beforeCommit = () => Promise.reject(new Error('interrupted'))
  const everything = async ({ db }: Database) =>
    JSON.stringify([
      await db.select().from(schema.people), await db.select().from(schema.timeEntries),
      await db.select().from(schema.invoices), await db.select().from(schema.numberSequences),
      await db.select().from(schema.companySettings), await db.select().from(schema.appMeta),
    ])

  it('leaves an empty database empty when seeding fails', async () => {
    const database = await createTestDatabase()
    const before = await everything(database)
    await expect(seedDemo(database.db, { beforeCommit })).rejects.toThrow('interrupted')
    expect(await everything(database)).toBe(before)
    await makeRecords(database.db).workplace()
    await database.close()
  }, 30_000)

  it('leaves the old data when resetting fails', async () => {
    const database = await createTestDatabase()
    await seedDemo(database.db, { today: '2026-11-23' })
    const { person } = await makeRecords(database.db).workplace()
    const before = await everything(database)
    await expect(resetDemo(database.db, { today: '2027-01-01', beforeCommit })).rejects.toThrow('interrupted')
    expect(await everything(database)).toBe(before)
    expect((await makeRecords(database.db).person()).id).toBeGreaterThan(person.id)
    await database.close()
  }, 30_000)

  it('refuses databases in use, writing nothing', async () => {
    const database = await createTestDatabase()
    const make = makeRecords(database.db)
    const client = await make.client()
    const before = await everything(database)
    await expect(seedDemo(database.db)).rejects.toThrow('holds clients')
    await expect(resetDemo(database.db)).rejects.toThrow('not demo data')
    expect(await everything(database)).toBe(before)
    await database.db.delete(schema.clients).where(eq(schema.clients.id, client.id))
    await make.person()
    const withPerson = await everything(database)
    await expect(seedDemo(database.db)).rejects.toThrow('holds people')
    await expect(resetDemo(database.db)).rejects.toThrow('not demo data')
    expect(await everything(database)).toBe(withPerson)
    await database.close()
  }, 30_000)
})

async function load({ db }: Database) {
  return {
    roles: await db.select().from(schema.roles),
    people: await db.select().from(schema.people),
    credentials: await db.select().from(schema.personCredentials),
    extras: await db.select().from(schema.personExtras),
    managers: await db.select().from(schema.personManagers),
    rates: await db.select().from(schema.personRates),
    clients: await db.select().from(schema.clients),
    contacts: await db.select().from(schema.contacts),
    exchangeRates: await db.select().from(schema.exchangeRates),
    tasks: await db.select().from(schema.tasks),
    projects: await db.select().from(schema.projects).orderBy(schema.projects.id),
    projectTasks: await db.select().from(schema.projectTasks),
    members: await db.select().from(schema.projectMembers),
    time: await db.select().from(schema.timeEntries),
    submissions: await db.select().from(schema.submissions),
    expenses: await db.select().from(schema.expenses),
    receipts: await db.select().from(schema.expenseReceipts),
    files: await db.select().from(schema.files),
    invoices: await db.select().from(schema.invoices).orderBy(schema.invoices.id),
    lines: await db.select().from(schema.invoiceLines),
    timeLinks: await db.select().from(schema.invoiceTimeEntries),
    expenseLinks: await db.select().from(schema.invoiceExpenses),
    payments: await db.select().from(schema.payments),
    writeOffs: await db.select().from(schema.invoiceWriteOffs),
    recurring: await db.select().from(schema.recurringInvoices),
    ledger: await db.select().from(schema.retainerEntries),
    estimates: await db.select().from(schema.estimates),
    estimateLines: await db.select().from(schema.estimateLines),
    policies: await db.select().from(schema.timeOffPolicies),
    requests: await db.select().from(schema.timeOffRequests),
    timeOff: await db.select().from(schema.timeOffEntries),
    calendars: await db.select().from(schema.holidayCalendars),
    holidays: await db.select().from(schema.holidays),
    assignments: await db.select().from(schema.assignments),
    milestones: await db.select().from(schema.milestones),
    notifications: await db.select().from(schema.notifications),
    outbox: await db.select().from(schema.outboxMessages),
    reports: await db.select().from(schema.savedReports),
    activity: await db.select().from(schema.activityLog),
  }
}

type Data = Awaited<ReturnType<typeof load>>

function find<T>(rows: T[], test: (row: T) => boolean): T {
  const row = rows.find(test)
  if (row === undefined) throw new Error('Not found')
  return row
}

/** The hourly rate of an entry, or null if it has none. */
function rateOf(data: Data, entry: Data['time'][number]): number | null {
  const project = find(data.projects, ({ id }) => id === entry.projectId)
  const onProject = (row: { projectId: number }) => row.projectId === entry.projectId
  const resolved = resolveBillableRate({
    date: entry.spentOn, billable: entry.billable, companyCurrency: 'USD',
    project: { ...project, currency: find(data.clients, ({ id }) => id === project.clientId).currency },
    task: {
      projectRate: find(data.projectTasks, (row) => onProject(row) && row.taskId === entry.taskId).rate,
      defaultRate: find(data.tasks, ({ id }) => id === entry.taskId).defaultRate,
    },
    person: {
      projectRate: find(data.members, (row) => onProject(row) && row.personId === entry.personId).rate,
      rates: data.rates.filter(({ personId, kind }) => personId === entry.personId && kind === 'billable'),
    },
  })
  return resolved.kind === 'rate' ? resolved.rate : null
}
