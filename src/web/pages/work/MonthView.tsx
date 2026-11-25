import type { TimeWeek } from '../../../shared/work'
import { useWeekStart } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { addDays, addMonths, ErrorState, LoadingState, partsOf, Select, weekdayNames, weekdayOf } from '../../ui'
import { classNames } from '../../ui/classNames'
import { formatDay, formatHours } from '../../work/format'

interface MonthViewProps {
  month: string
  today: string
  personId: number | null
  onDay: (day: string) => void
}

/** The hours of each day of a month. */
export function MonthView({ month, today, personId, onDay }: MonthViewProps) {
  const weekStart = useWeekStart()
  const { status, data, error, reload } = useLoad<{ days: { day: string; minutes: number }[] }>(`time/month?month=${month}${personId === null ? '' : `&person=${personId}`}`)
  if (status === 'error') return <ErrorState message={error} onRetry={reload} />
  if (!data) return <LoadingState look="skeleton" label="Loading the month" />
  const first = `${month}-01`
  const before = (weekdayOf(first) - weekStart + 7) % 7
  const count = partsOf(addDays(addMonths(first, 1), -1)).day
  const on = (day: string) => data.days.find((one) => one.day === day)?.minutes ?? 0
  const total = data.days.reduce((sum, { minutes }) => sum + minutes, 0)
  return (
    <div className="stack">
      <div className="month">
        {Array.from({ length: 7 }, (_, index) => weekdayNames[(weekStart + index) % 7] ?? '').map((name) => (
          <span key={name} className="month-name" aria-hidden="true">
            {name.slice(0, 3)}
          </span>
        ))}
        {Array.from({ length: before }, (_, index) => (
          <span key={`before ${index}`} className="month-day is-empty" />
        ))}
        {Array.from({ length: count }, (_, index) => addDays(first, index)).map((day) => (
          <button key={day} type="button" className={classNames('month-day', day === today && 'is-now')} aria-current={day === today ? 'date' : undefined} aria-label={`${partsOf(day).day}, ${formatDay(day)}, ${formatHours(on(day))} hours`} onClick={() => onDay(day)}>
            <span>{partsOf(day).day}</span>
            {on(day) > 0 && <span className="figure">{formatHours(on(day))}</span>}
          </button>
        ))}
        {Array.from({ length: (7 - ((before + count) % 7)) % 7 }, (_, index) => (
          <span key={`after ${index}`} className="month-day is-empty" />
        ))}
      </div>
      <p className="day-total">
        <span>Month total</span> <span className="figure">{formatHours(total)}</span>
      </p>
    </div>
  )
}

/** Whose timesheet it is. */
export function PersonPicker({ week, onChoose }: { week: TimeWeek; onChoose: (id: string | null) => void }) {
  const { people } = week
  if (people.length === 0) return null
  const options = people.some(({ id }) => id === week.person.id) ? people : [week.person, ...people]
  return (
    <div className="person-picker">
      <Select label="Timesheet of" hideLabel value={String(week.person.id)} options={options.map(({ id, name }) => ({ value: String(id), label: name }))} onChange={(id) => onChoose(id)} />
    </div>
  )
}
