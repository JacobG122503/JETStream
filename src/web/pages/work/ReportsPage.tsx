import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PermissionKey } from '../../../shared/permissions'
import type { ReportRow, TimeReport } from '../../../shared/work'
import { useCan } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Button, Checkbox, ErrorState, IconButton, LoadingState, Ring, Tabs } from '../../ui'
import { formatHours, formatMoney, moneyInput, percentOf } from '../../work/format'
import { downloadCsv } from '../../work/csv'
import { Amounts } from '../../work/parts'
import { PeriodBar, usePeriod } from '../../work/Period'
import { ReportsNav } from './ReportsNav'
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

export function ReportsPage() {
  const period = usePeriod('week')
  const { range } = period
  const [activeOnly, setActiveOnly] = useState(false)
  const { status, data, error, reload } = useLoad<TimeReport>(`reports/time?from=${range.start}&to=${range.end}${activeOnly ? '&active=1' : ''}`)
  return (
    <Page title="Reports">
      <ReportsNav current="/reports" />
      <PeriodBar period={period} />
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

function download(title: string, rows: ReportRow[], { from, to }: TimeReport) {
  downloadCsv(`${title.toLowerCase()} ${from} to ${to}`, [
    ['Name', 'Client', 'Hours', 'Billable hours', 'Amount', 'Currency'],
    ...rows.map(({ name, sub, minutes, billableMinutes, amount, currency }) => [
      name, sub ?? '', (minutes / 60).toFixed(2), (billableMinutes / 60).toFixed(2), amount === null ? '' : moneyInput(amount, currency ?? 'USD'), amount === null ? '' : (currency ?? ''),
    ]),
  ])
}
