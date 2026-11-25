import { useState } from 'react'
import { usePerson, useWeekStart } from '../auth/authContext'
import { addDays, addMonths, type DateRange, DateRangePicker, Icon, IconButton, partsOf, Select, startOfWeek, toIso, type Weekday } from '../ui'
import { formatWeek } from './format'

const months = { month: 1, quarter: 3, year: 12 } as const
type Step = 'week' | keyof typeof months
type Kind = Step | 'custom'

function rangeOf(step: Step, date: string, weekStart: Weekday): DateRange {
  if (step === 'week') {
    const start = startOfWeek(date, weekStart)
    return { start, end: addDays(start, 6) }
  }
  const { year, month } = partsOf(date)
  const start = toIso({ year, month: month - ((month - 1) % months[step]), day: 1 })
  return { start, end: addDays(addMonths(start, months[step]), -1) }
}

const todayIn = (timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0, 10)

/** A week, month, quarter, year or any dates. */
// eslint-disable-next-line react-refresh/only-export-components -- belongs to the bar
export function usePeriod(first: Step) {
  const { timeZone } = usePerson()
  const weekStart = useWeekStart()
  const today = todayIn(timeZone)
  const [kind, setKind] = useState<Kind>(first)
  const [range, setRange] = useState<DateRange>(() => rangeOf(first, today, weekStart))
  const choose = (next: Kind) => {
    setKind(next)
    if (next !== 'custom') setRange(rangeOf(next, today, weekStart))
  }
  const move = (by: 1 | -1) => {
    if (kind === 'custom') return
    setRange(kind === 'week' ? rangeOf('week', addDays(range.start, by * 7), weekStart) : rangeOf(kind, addMonths(range.start, by * months[kind]), weekStart))
  }
  return { kind, range, setRange, choose, move, today, weekStart }
}

export function PeriodBar({ period: { kind, range, setRange, choose, move, today, weekStart } }: { period: ReturnType<typeof usePeriod> }) {
  const current = today >= range.start && today <= range.end
  return (
    <div className="time-bar no-print">
      <Select
        label="Period"
        hideLabel
        value={kind}
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter' },
          { value: 'year', label: 'Year' },
          { value: 'custom', label: 'Custom' },
        ]}
        onChange={(value) => choose(value as Kind)}
      />
      {kind === 'custom' ? (
        <DateRangePicker label="Dates" weekStart={weekStart} value={range} onChange={setRange} today={today} />
      ) : (
        <div className="date-nav">
          <IconButton icon="chevronLeft" label={`Previous ${kind}`} onClick={() => move(-1)} />
          <p aria-live="polite">
            <Icon name="calendar" />
            <span>
              {current && <span className="muted">This {kind} </span>}
              {formatWeek(range.start, range.end)}
            </span>
          </p>
          <IconButton icon="chevronRight" label={`Next ${kind}`} onClick={() => move(1)} />
        </div>
      )}
      {kind !== 'custom' && !current && (
        <button type="button" className="text-button" onClick={() => choose(kind)}>
          Return to this {kind}
        </button>
      )}
    </div>
  )
}
