/** Fills an empty database with the demo company, and empties one that holds it. */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getTableName, sql } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { IsoDate } from '../../shared/dates'
import { todayIn } from '../clock'
import { type Db, runTransaction, type Tx } from '../db'
import { appMeta, clients, companySettings, people, personCredentials, roles } from '../db/schema'
import { errorCode, StartupError } from '../errors'
import { migrationsDir } from '../paths'
import { hashPassword } from '../security/passwords'
import { Choices, demoDates, DemoRows } from './builder'
import { addCompany, demoAccounts, demoPassword, type RoleIds } from './company'
import { addExtras } from './extras'
import { addMoney } from './money'
import { addWork } from './work'

/** Key of the demo marker in app_meta. Its value is the date the data was made for. */
const markerKey = 'demo_seed'

/** The date the demo data was made for, or null when the database does not hold demo data. */
export async function demoSeedDate(db: Db): Promise<IsoDate | null> {
  const rows = await db.select().from(appMeta)
  return rows.find(({ key }) => key === markerKey)?.value ?? null
}

async function holdsAny(db: Db, table: typeof people | typeof clients): Promise<boolean> {
  return (await db.select({ id: table.id }).from(table).limit(1)).length > 0
}

export const holdsPeople = (db: Db) => holdsAny(db, people)

const undefinedTable = '42P01'

/** Refuses to seed a database in use. Also works, and writes nothing, before migrations are applied. */
export async function checkSeedAllowed(db: Db): Promise<void> {
  await beforeMigrations(async () => {
    if (await holdsPeople(db)) {
      throw new StartupError('The database already holds people. Demo data is only added to an empty database.')
    }
    if (await holdsAny(db, clients)) {
      throw new StartupError('The database already holds clients. Demo data is only added to an empty database.')
    }
  })
}

/** Refuses to erase anything that is not demo data. */
export async function checkResetAllowed(db: Db): Promise<void> {
  await beforeMigrations(async () => {
    if ((await demoSeedDate(db)) !== null) return
    if ((await holdsPeople(db)) || (await holdsAny(db, clients))) {
      throw new StartupError('The database holds records that are not demo data. They are never erased by this command.')
    }
  })
}

async function beforeMigrations(check: () => Promise<void>) {
  try {
    await check()
  } catch (error) {
    if (errorCode(error) !== undefinedTable) throw error
  }
}

export interface SeedOptions {
  /** The date the data is made for; today in the company time zone if left out. */
  today?: IsoDate
  /** For tests: runs at the end, inside the transaction. */
  beforeCommit?: (tx: Tx) => Promise<void>
}

/** Adds the demo data to a migrated database without people or clients. All or nothing. */
export async function seedDemo(db: Db, options: SeedOptions = {}): Promise<IsoDate> {
  const hashes = await hashPasswords()
  return runTransaction(db, async (tx) => {
    await keepOthersOut(tx)
    await checkSeedAllowed(tx)
    return fill(tx, hashes, options)
  })
}

/** Erases demo data and adds it afresh. All or nothing. */
export async function resetDemo(db: Db, options: SeedOptions = {}): Promise<IsoDate> {
  const hashes = await hashPasswords()
  const reference = await referenceStatements()
  return runTransaction(db, async (tx) => {
    await keepOthersOut(tx)
    await checkResetAllowed(tx)
    const tables = await tableNames(tx)
    await tx.execute(sql`truncate ${sql.join(tables.map((name) => sql.identifier(name)), sql`, `)} restart identity`)
    for (const statement of reference) await tx.execute(sql.raw(statement))
    return fill(tx, hashes, options)
  })
}

/** So that nothing is added between checking and filling, and two commands take turns. */
const keepOthersOut = (tx: Tx) => tx.execute(sql`lock table people, clients in access exclusive mode`)

// Before the transaction: hashing is slow on purpose.
const hashPasswords = () => Promise.all(demoAccounts.map(() => hashPassword(demoPassword)))

async function tableNames(db: Db): Promise<string[]> {
  const { rows } = (await db.execute(
    sql`select tablename as name from pg_tables where schemaname = 'public' order by 1`,
  )) as { rows: { name: string }[] }
  return rows.map(({ name }) => name)
}

/** The reference data of the migrations, which emptying the tables takes away too. */
async function referenceStatements(): Promise<string[]> {
  const names = (await readdir(migrationsDir)).filter((name) => /_reference_.*\.sql$/.test(name)).sort()
  const files = await Promise.all(names.map((name) => readFile(join(migrationsDir, name), 'utf8')))
  return files.flatMap((text) => text.split('--> statement-breakpoint'))
}

async function fill(tx: Tx, hashes: string[], { today, beforeCommit }: SeedOptions): Promise<IsoDate> {
  const [settings] = await tx.select().from(companySettings)
  if (!settings) throw new Error('The company settings are missing.')
  const { timeZone } = settings
  const dates = demoDates(today ?? todayIn(timeZone), timeZone)

  const rows = new DemoRows(dates.now)
  const company = addCompany(rows, dates, await roleIds(tx))
  for (const [index, { key }] of demoAccounts.entries()) {
    const personId = company.people[key].id
    rows.add(personCredentials, { personId, passwordHash: hashes[index] ?? '', changedAt: dates.now })
  }
  const work = addWork(rows, dates, new Choices(20_260_101), company)
  addExtras(rows, dates, company)

  for (const [table, values] of rows.tables) await insertAll(tx, table, values)
  await tx.update(companySettings).set({
    address: '100 Example Parkway\nSpringfield, IL 62700', reminderDays: [3, 14, 30], invoiceNotes: 'Thank you for your business.',
  })
  await addMoney(tx, dates, company, work)
  await tx.insert(appMeta).values({ key: markerKey, value: dates.today })
  await settleTimes(tx, dates.now)
  await beforeCommit?.(tx)
  return dates.today
}

async function roleIds(tx: Tx): Promise<RoleIds> {
  const stored = await tx.select().from(roles)
  const idOf = (key: keyof RoleIds) => {
    const role = stored.find((candidate) => candidate.key === key)
    if (!role) throw new Error(`The built-in role ${key} is missing.`)
    return role.id
  }
  return { administrator: idOf('administrator'), manager: idOf('manager'), member: idOf('member') }
}

const rowsPerStatement = 400

async function insertAll(tx: Tx, table: PgTable, values: Record<string, unknown>[]) {
  for (let start = 0; start < values.length; start += rowsPerStatement) {
    await tx.insert(table).values(values.slice(start, start + rowsPerStatement))
  }
  if (!('id' in table)) return
  // The rows brought their own keys. Unlike setval, this is undone with the transaction.
  const name = getTableName(table)
  const { rows } = (await tx.execute(
    sql`select pg_get_serial_sequence(${name}, 'id') as sequence`,
  )) as { rows: { sequence: string | null }[] }
  const sequence = rows[0]?.sequence
  if (sequence) await tx.execute(sql.raw(`alter sequence ${sequence} restart with ${values.length + 1}`))
}

/** Records stamped with the time of seeding, or of the migrations, get the demo's own time. */
async function settleTimes(tx: Tx, now: Date) {
  const { rows } = (await tx.execute(sql`
    select table_name as "table", column_name as "column" from information_schema.columns
    where table_schema = 'public' and data_type = 'timestamp with time zone' order by 1, 2`)) as {
    rows: { table: string; column: string }[]
  }
  for (const { table, column } of rows) {
    const [name, time] = [sql.identifier(table), sql.identifier(column)]
    await tx.execute(sql`update ${name} set ${time} = ${now.toISOString()}::timestamptz where ${time} = now()`)
  }
  for (const table of ['roles', 'company_settings', 'number_sequences', 'item_categories']) {
    const at = now.toISOString()
    await tx.execute(
      sql`update ${sql.identifier(table)} set created_at = ${at}::timestamptz, updated_at = ${at}::timestamptz, version = 1`,
    )
  }
}
