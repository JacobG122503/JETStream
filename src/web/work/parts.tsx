import type { ProjectRow } from '../../shared/work'
import { Avatar, type ChartSeries, Meter } from '../ui'
import { photoUrl } from '../shell/photo'
import { formatHours, formatMoney, percentOf } from './format'

// eslint-disable-next-line react-refresh/only-export-components -- belongs to the charts of hours
export const hourSeries: ChartSeries[] = [
  { id: 'billable', label: 'Billable', colour: 1 },
  { id: 'other', label: 'Not billable', colour: 'rest' },
]

/** How much of a project's budget is used, in words and as a bar. */
export function BudgetBar({ project: { budget, currency } }: { project: Pick<ProjectRow, 'budget' | 'currency'> }) {
  if (!budget) return <span className="muted">No budget</span>
  const amount = (value: number) => (budget.unit === 'hours' ? formatHours(value) : formatMoney(value, currency, { whole: true }))
  const percent = percentOf(budget.used, budget.total)
  const over = budget.used > budget.total
  const near = !over && budget.alertPercent !== null && percent * 1000 >= budget.alertPercent
  return (
    <span className="budget">
      <span className="budget-words">
        <span className="figure">
          {amount(budget.used)} <span className="muted">of {amount(budget.total)}{budget.monthly ? ' this month' : ''}</span>
        </span>
        <span className={over ? 'budget-over' : near ? 'budget-near' : 'budget-fine'}>
          {over ? `Over, ${percent}%` : near ? `Close, ${percent}%` : `${percent}%`}
        </span>
      </span>
      <Meter percent={percent} over={over} />
    </span>
  )
}

const mostShown = 4

export function AvatarStack({ people }: { people: ProjectRow['members'] }) {
  const more = people.length - mostShown
  return (
    <span className="stack-avatars" role="img" aria-label={`${people.length === 1 ? '1 person' : `${people.length} people`}: ${people.map(({ name }) => name).join(', ')}`}>
      {people.slice(0, mostShown).map(({ id, name, photoId }) => (
        <Avatar key={id} name={name} src={photoUrl(photoId)} size="small" decorative />
      ))}
      {more > 0 && <span className="stack-more" aria-hidden="true">{`+${more}`}</span>}
    </span>
  )
}
