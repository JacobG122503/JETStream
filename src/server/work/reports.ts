/** Hours and what they are worth, over a period. */
import { and, between, eq, isNull, or } from 'drizzle-orm'
import { addDays, type IsoDate } from '../../shared/dates'
import type { ReportRow, TimeReport } from '../../shared/work'
import type { Actor } from '../access/actor'
import { can, holds, ownId } from '../access/decisions'
import { invalidInput } from '../api/input'
import { filterFor } from '../access/filters'
import type { AppContext } from '../context'
import { clients, projects, timeEntries } from '../db/schema'
import { byCurrency, groupRows, isUnbilled, loadValued, sumBy, type Valued } from './figures'

const mostRange = 5 * 366

export interface ReportPeriod {
  from: IsoDate
  to: IsoDate
  /** Leaves out archived projects and clients. */
  activeOnly: boolean
}

export async function readTimeReport(ctx: AppContext, actor: Actor, { from, to, activeOnly }: ReportPeriod): Promise<TimeReport> {
  if (from > to) throw invalidInput({ to: 'The end is before the start.' })
  if (addDays(from, mostRange) < to) throw invalidInput({ to: 'Choose at most five years.' })
  const { db } = ctx
  const own = eq(timeEntries.personId, ownId(actor))
  const team = holds(actor, 'time.view')
  const scope = team ? or(own, filterFor(db, actor, 'time.view', 'timeEntry')) : own
  const active = activeOnly ? and(isNull(projects.archivedAt), isNull(clients.archivedAt)) : undefined
  const rows = await loadValued(db, and(scope, between(timeEntries.spentOn, from, to), active))
  const seesMoney = ({ projectId }: Valued) => can(actor, 'billable.view', { type: 'project', projectId })
  const money = rows.filter(seesMoney)

  const group = (keyOf: (row: Valued) => number, describe: (row: Valued) => Pick<ReportRow, 'name' | 'sub'>): ReportRow[] =>
    [...groupRows(rows, keyOf)]
      .map(([id, part]) => {
        const currencies = [...new Set(part.map(({ currency }) => currency))]
        const complete = part.every(seesMoney) && currencies.length === 1
        return {
          id, ...describe(part[0] as Valued),
          minutes: sumBy(part, ({ worked }) => worked),
          billableMinutes: sumBy(part.filter(({ billable }) => billable), ({ worked }) => worked),
          amount: complete ? sumBy(part, ({ amount }) => amount ?? 0) : null,
          ...(currencies.length === 1 && { currency: currencies[0] }),
        }
      })
      .sort((a, b) => b.minutes - a.minutes)

  return {
    from, to, scope: team ? 'team' : 'own',
    minutes: sumBy(rows, ({ worked }) => worked),
    billableMinutes: sumBy(rows.filter(({ billable }) => billable), ({ worked }) => worked),
    showAmounts: holds(actor, 'billable.view'),
    amounts: byCurrency(money, ({ amount }) => amount ?? 0),
    uninvoiced: byCurrency(money.filter(isUnbilled), ({ amount }) => amount ?? 0),
    byClient: group((row) => row.clientId, ({ client }) => ({ name: client })),
    byProject: group((row) => row.projectId, ({ project, client }) => ({ name: project, sub: client })),
    byTask: group((row) => row.taskId, ({ task }) => ({ name: task })),
    byPerson: group((row) => row.personId, ({ person }) => ({ name: person })),
  }
}
