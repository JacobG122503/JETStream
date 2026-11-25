import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PermissionKey } from '../../../shared/permissions'
import { productName } from '../../../shared/product'
import type { ReportRow, TimeReport } from '../../../shared/work'
import { useCan, usePerson, useWeekStart } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { addDays, addMonths, Button, Checkbox, type DateRange, DateRangePicker, ErrorState, Icon, IconButton, LoadingState, partsOf, Ring, Select, startOfWeek, Tabs, toIso, type Weekday } from '../../ui'
import { formatHours, formatMoney, formatWeek, percentOf } from '../../work/format'
import { Amounts } from '../../work/parts'
import '../../work/work.css'

interface GroupInfo {
  id: 'byClient' | 'byProject' | 'byTask' | 'byPerson'
  label: string
  /** Where a name leads, for those who may go there. */
  path?: string
  needs?: PermissionKey
}

const groups: GroupInfo[] = [
  { id: 'byClient', label: 'Clients', path: '/clients', needs: 'clients.view' },
  { id: 'byProject', label: 'Projects', path: '/projects' },
  { id: 'byTask', label: 'Tasks' },
  { id: 'byPerson', label: 'Teammates', path: '/team', needs: 'people.view' },
]

const months = { month: 1, quarter: 3, year: 12 } as const
type Step = 'week' | keyof typeof months
type Period = Step | 'custom'

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

export function ReportsPage() {
  const { timeZone } = usePerson()
  const weekStart = useWeekStart()
  const today = todayIn(timeZone)
  const [period, setPeriod] = useState<Period>('week')
  const [range, setRange] = useState<DateRange>(() => rangeOf('week', today, weekStart))
  const [activeOnly, setActiveOnly] = useState(false)
  const { status, data, error, reload } = useLoad<TimeReport>(`reports/time?from=${range.start}&to=${range.end}${activeOnly ? '&active=1' : ''}`)

  const choose = (next: Period) => {
    setPeriod(next)
    if (next !== 'custom') setRange(rangeOf(next, today, weekStart))
  }
  const move = (by: 1 | -1) => {
    if (period === 'custom') return
    setRange(period === 'week' ? rangeOf('week', addDays(range.start, by * 7), weekStart) : rangeOf(period, addMonths(range.start, by * months[period]), weekStart))
  }
  const current = today >= range.start && today <= range.end

  return (
    <Page title="Reports">
      <div className="time-bar no-print">
        <Select
          label="Period"
          hideLabel
          value={period}
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'quarter', label: 'Quarter' },
            { value: 'year', label: 'Year' },
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(value) => choose(value as Period)}
        />
        {period === 'custom' ? (
          <DateRangePicker label="Dates" weekStart={weekStart} value={range} onChange={setRange} today={today} />
        ) : (
          <div className="date-nav">
            <IconButton icon="chevronLeft" label={`Previous ${period}`} onClick={() => move(-1)} />
            <p aria-live="polite">
              <Icon name="calendar" />
              <span>
                {current && <span className="muted">This {period} </span>}
                {formatWeek(range.start, range.end)}
              </span>
            </p>
            <IconButton icon="chevronRight" label={`Next ${period}`} onClick={() => move(1)} />
          </div>
        )}
        {period !== 'custom' && !current && (
          <button type="button" className="text-button" onClick={() => choose(period)}>
            Return to this {period}
          </button>
        )}
      </div>
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the report" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && <Report report={data} activeOnly={activeOnly} onActiveOnly={setActiveOnly} />}
    </Page>
  )
}

interface ReportProps {
  report: TimeReport
  activeOnly: boolean
  onActiveOnly: (on: boolean) => void
}

function Report({ report, activeOnly, onActiveOnly }: ReportProps) {
  const can = useCan()
  const { minutes, billableMinutes, showAmounts, amounts, uninvoiced, scope } = report
  const percent = percentOf(billableMinutes, minutes)
  const amount = (value: TimeReport['amounts']): ReactNode => (showAmounts ? <Amounts amounts={value} /> : 'N/A')
  return (
    <>
      <div className="report-panel">
        <div>
          <p>Total hours</p>
          <p className="report-figure">{formatHours(minutes)}</p>
        </div>
        <div className="report-share">
          <Ring percent={percent} label={`${percent}% billable`}>
            <strong>{percent}%</strong>
          </Ring>
          <dl>
            <dt>
              <span className="legend-key key-billable" /> Billable
            </dt>
            <dd>{formatHours(billableMinutes)}</dd>
            <dt>
              <span className="legend-key key-other" /> Non-billable
            </dt>
            <dd>{formatHours(minutes - billableMinutes)}</dd>
          </dl>
        </div>
        <div>
          <p>Billable amount</p>
          <p className="report-figure">{amount(amounts)}</p>
        </div>
        <div>
          <p>Uninvoiced amount</p>
          <p className="report-figure">{amount(uninvoiced)}</p>
        </div>
      </div>
      <Tabs
        label="Hours by"
        items={groups
          .filter(({ id }) => scope === 'team' || id !== 'byPerson')
          .map(({ id, label, path, needs }) => ({
            id,
            label,
            content: (
              <div className="stack">
                <div className="report-tools no-print">
                  <Checkbox label="Active projects only" checked={activeOnly} onChange={onActiveOnly} />
                  <Button size="small" aria-disabled={report[id].length === 0 || undefined} onClick={() => download(label, report[id], report)}>
                    Export CSV
                  </Button>
                  <IconButton size="small" variant="secondary" icon="printer" label="Print" onClick={() => window.print()} />
                </div>
                <Group title={label} rows={report[id]} report={report} path={path && (!needs || can(needs)) ? path : undefined} />
              </div>
            ),
          }))}
      />
    </>
  )
}

/** One line for each currency. */
const totals = (amounts: TimeReport['amounts']): ReactNode =>
  amounts.map(({ currency, amount }) => (
    <span key={currency} className="line">
      {formatMoney(amount, currency)}
    </span>
  ))

interface GroupProps {
  title: string
  rows: ReportRow[]
  report: TimeReport
  path: string | undefined
}

function Group({ title, rows, report, path }: GroupProps) {
  const most = Math.max(1, ...rows.map(({ minutes }) => minutes))
  const { showAmounts } = report
  if (rows.length === 0) return <div className="day-empty">Nothing was tracked in this period.</div>
  return (
    <div className="table-scroll team-scroll" tabIndex={0} role="region" aria-label={title}>
      <table className="team-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col" className="is-numeric">
              Hours
            </th>
            <th scope="col">
              <span className="sr-only">Share</span>
            </th>
            <th scope="col" className="is-numeric">
              Billable hours
            </th>
            {showAmounts && (
              <th scope="col" className="is-numeric">
                Billable amount
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, name, sub, minutes, billableMinutes, amount, currency }) => (
            <tr key={id}>
              <th scope="row">
                {path ? <Link to={`${path}/${id}`}>{name}</Link> : name}
                {sub && <span className="muted"> ({sub})</span>}
              </th>
              <td className="is-numeric">{formatHours(minutes)}</td>
              <td className="team-bar">
                <span className="share" aria-hidden="true">
                  <span className="key-billable" style={{ width: `${(billableMinutes / most) * 100}%` }} />
                  <span className="key-other" style={{ width: `${((minutes - billableMinutes) / most) * 100}%` }} />
                </span>
              </td>
              <td className="is-numeric">
                {formatHours(billableMinutes)} <span className="muted">({percentOf(billableMinutes, minutes)}%)</span>
              </td>
              {showAmounts && <td className="is-numeric">{amount === null || currency === undefined ? <span className="muted">-</span> : formatMoney(amount, currency)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="is-numeric">{formatHours(report.minutes)}</td>
            <td />
            <td className="is-numeric">{formatHours(report.billableMinutes)}</td>
            {showAmounts && <td className="is-numeric">{totals(report.amounts)}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/** A spreadsheet would run a text that begins like a formula. */
const cellText = (value: string | number) => {
  const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function download(title: string, rows: ReportRow[], { from, to }: TimeReport) {
  const lines = [
    ['Name', 'Client', 'Hours', 'Billable hours', 'Amount', 'Currency'],
    ...rows.map(({ name, sub, minutes, billableMinutes, amount, currency }) => [
      name, sub ?? '', (minutes / 60).toFixed(2), (billableMinutes / 60).toFixed(2), amount === null ? '' : formatMoney(amount, currency ?? 'USD').replace(/[^\d.]/g, ''), amount === null ? '' : (currency ?? ''),
    ]),
  ]
  const file = new Blob([lines.map((cells) => cells.map(cellText).join(',')).join('\r\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = `${productName} ${title.toLowerCase()} ${from} to ${to}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
