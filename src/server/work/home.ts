/** What matters now, for whoever is signed in. */
import { and, asc, between, desc, eq, inArray, isNull } from 'drizzle-orm'
import { addDays, addMonths, startOfWeek, type Weekday } from '../../shared/dates'
import type { HomeInfo, TimeEntry } from '../../shared/work'
import { type Actor, isSystem } from '../access/actor'
import { holds, ownId } from '../access/decisions'
import { filterFor } from '../access/filters'
import type { AppContext } from '../context'
import { type Db, sumExact } from '../db'
import { invoices, payments, people, projects, timeEntries } from '../db/schema'
import { getSettings } from '../people/lookup'
import { byCurrency, groupRows, loadValued, selectTime, sumBy } from './figures'
import { listInvoices, listUnbilled } from './invoices'
import { listProjects } from './projects'
import { readRunning, toEntry, todayOf } from './time'

const recentCount = 5
const shownMonths = 6

/** The last things worked on, each project and task once. */
async function readRecent(db: Db, personId: number): Promise<TimeEntry[]> {
  const rows = await selectTime(db).where(eq(timeEntries.personId, personId)).orderBy(desc(timeEntries.spentOn), desc(timeEntries.id)).limit(40)
  const unique = groupRows(rows, ({ projectId, taskId }) => `${projectId}/${taskId}`)
  return [...unique.values()].slice(0, recentCount).map(([first]) => toEntry(() => false)(first as (typeof rows)[number]))
}

async function readMoney(ctx: AppContext, actor: Actor, today: string): Promise<HomeInfo['money']> {
  const { db } = ctx
  const { currency } = await getSettings(db)
  const { invoices: rows } = await listInvoices(ctx, actor)
  const open = rows.filter(({ status }) => status === 'open')
  const late = open.filter((row) => row.late)
  const unbilled = await listUnbilled(db, actor, { from: null, to: null })
  const months = Array.from({ length: shownMonths }, (_, index) => addMonths(today, index - shownMonths + 1).slice(0, 7))
  const paid = await db
    .select({ paidOn: payments.paidOn, amount: payments.amount })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(and(filterFor(db, actor, 'invoices.manage', 'invoice'), eq(invoices.currency, currency)))
  return {
    outstanding: byCurrency(open, ({ dueAmount }) => dueAmount),
    late: byCurrency(late, ({ dueAmount }) => dueAmount).map((row) => ({ ...row, count: late.filter((invoice) => invoice.currency === row.currency).length })),
    drafts: rows.filter(({ status }) => status === 'draft').length,
    unbilled: byCurrency(unbilled, ({ total }) => total),
    currency,
    months: months.map((month) => ({
      month,
      invoiced: sumBy(rows.filter((row) => row.currency === currency && row.status !== 'draft' && row.issuedOn.startsWith(month)), ({ total }) => total),
      paid: sumBy(paid.filter(({ paidOn }) => paidOn.startsWith(month)), ({ amount }) => amount),
    })),
  }
}

async function readTeam(db: Db, actor: Actor, from: string, to: string): Promise<HomeInfo['team']> {
  const rows = await db
    .select({ id: people.id, name: people.name, photoId: people.photoFileId, capacityMinutes: people.weeklyCapacityMinutes })
    .from(people)
    .where(and(eq(people.status, 'active'), filterFor(db, actor, 'people.view', 'person')))
    .orderBy(asc(people.name))
  if (rows.length === 0) return []
  const worked = await db
    .select({ id: timeEntries.personId, minutes: sumExact(timeEntries.minutes) })
    .from(timeEntries)
    .where(and(inArray(timeEntries.personId, rows.map(({ id }) => id)), between(timeEntries.spentOn, from, to), filterFor(db, actor, 'time.view', 'timeEntry')))
    .groupBy(timeEntries.personId)
  return rows.map((row) => ({ ...row, minutes: worked.find(({ id }) => id === row.id)?.minutes ?? 0 }))
}

export async function readHome(ctx: AppContext, actor: Actor): Promise<HomeInfo> {
  const { db } = ctx
  const personId = ownId(actor)
  const now = ctx.now()
  const today = await todayOf(db, personId, now)
  const { weekStartsOn } = await getSettings(db)
  const from = startOfWeek(today, weekStartsOn as Weekday)
  const to = addDays(from, 6)
  const mine = await loadValued(db, and(eq(timeEntries.personId, personId), between(timeEntries.spentOn, from, to)))
  const [person] = await db.select({ capacity: people.weeklyCapacityMinutes }).from(people).where(eq(people.id, personId))
  const all = await listProjects(ctx, actor, isNull(projects.archivedAt))
  const managed = isSystem(actor) ? new Set<number>() : actor.managed.projects
  const relevant = all.filter(({ id, members }) => managed.has(id) || members.some((member) => member.id === personId) || holds(actor, 'projects.view', 'all'))
  const share = ({ budget }: (typeof all)[number]) => (budget ? budget.used / budget.total : 0)
  return {
    today,
    week: Array.from({ length: 7 }, (_, index) => {
      const day = addDays(from, index)
      const rows = mine.filter(({ spentOn }) => spentOn === day)
      const billable = sumBy(rows.filter((row) => row.billable), ({ worked }) => worked)
      return { day, billable, other: sumBy(rows, ({ worked }) => worked) - billable }
    }),
    capacityMinutes: person?.capacity ?? 0,
    running: await readRunning(db, personId),
    now: now.toISOString(),
    recent: await readRecent(db, personId),
    projects: relevant.filter(({ budget }) => budget !== null).sort((a, b) => share(b) - share(a)).slice(0, 5),
    ...(holds(actor, 'invoices.manage') && { money: await readMoney(ctx, actor, today) }),
    ...(holds(actor, 'people.view') && holds(actor, 'time.view') && { team: await readTeam(db, actor, from, to) }),
  }
}
