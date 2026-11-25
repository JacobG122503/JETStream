import { usePerson, useWeekStart } from '../auth/authContext'
import { addDays, addMonths, type DateRange, DateRangePicker, Icon, IconButton, isIsoDate, Menu, partsOf, startOfWeek, toIso, type Weekday } from '../ui'
import { formatWeek } from './format'
import { useQuery } from './query'

const months = { month: 1, quarter: 3, year: 12 } as const
type Step = 'week' | keyof typeof months
type Kind = Step | 'custom'

const kindLabels: Record<Kind, string> = { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year', custom: 'Custom' }
const kinds = Object.keys(kindLabels) as Kind[]

function rangeOf(step: Step, date: string, weekStart: Weekday): DateRange {
  if (step === 'week') {
    const start = startOfWeek(date, weekStart)
    return { start, end: addDays(start, 6) }
  }
  const { year, month } = partsOf(date)
  const start = toIso({ year, month: month - ((month - 1) % months[step]), day: 1 })
  return { start, end: addDays(addMonths(start, months[step]), -1) }
}

// eslint-disable-next-line react-refresh/only-export-components -- belongs to the bar
export function useToday(): string {
  const { timeZone } = usePerson()
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0, 10)
}

/** A week, month, quarter, year or any dates, kept in the address. The current one is not written there, so a saved page stays current. */
// eslint-disable-next-line react-refresh/only-export-components -- belongs to the bar
export function usePeriod(first: Step) {
  const weekStart = useWeekStart()
  const today = useToday()
  const { get, change } = useQuery()
  const kind = kinds.find((known) => known === get('period')) ?? first
  const from = isIsoDate(get('from')) ? get('from') : ''
  const to = isIsoDate(get('to')) ? get('to') : ''
  const range: DateRange =
    kind === 'custom' ? (from && to && from <= to ? { start: from, end: to } : rangeOf(first, today, weekStart)) : rangeOf(kind, from || today, weekStart)
  const go = (step: Step, date: string) => {
    const next = rangeOf(step, date, weekStart)
    const now = today >= next.start && today <= next.end
    change({ period: step === first ? null : step, from: now ? null : next.start, to: null })
  }
  const setRange = ({ start, end }: DateRange) => change({ period: 'custom', from: start, to: end })
  const choose = (next: Kind) => (next === 'custom' ? setRange(range) : go(next, today))
  const move = (by: 1 | -1) => {
    if (kind === 'custom') return
    go(kind, kind === 'week' ? addDays(range.start, by * 7) : addMonths(range.start, by * months[kind]))
  }
  return { kind, range, setRange, choose, move, today, weekStart }
}

export function PeriodBar({ period: { kind, range, setRange, choose, move, today, weekStart } }: { period: ReturnType<typeof usePeriod> }) {
  const current = today >= range.start && today <= range.end
  return (
    <div className="time-bar no-print">
      <Menu
        label={kindLabels[kind]}
        items={kinds.map((id) => ({ id, label: kindLabels[id], checked: id === kind, onSelect: () => choose(id) }))}
      />
      {kind === 'custom' ? (
        <DateRangePicker label="Dates" weekStart={weekStart} value={range} onChange={setRange} today={today} />
      ) : (
        <div className="date-nav">
          <IconButton icon="arrowLeft" label={`Previous ${kind}`} onClick={() => move(-1)} />
          <p aria-live="polite">
            <Icon name="calendar" />
            <span>
              {current && <strong>This {kind} </strong>}
              {formatWeek(range.start, range.end)}
            </span>
          </p>
          <IconButton icon="arrowRight" label={`Next ${kind}`} onClick={() => move(1)} />
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
