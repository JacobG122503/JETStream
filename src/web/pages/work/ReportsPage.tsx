import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PermissionKey } from '../../../shared/permissions'
import type { ReportRow, TimeReport } from '../../../shared/work'
import { useCan } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { photoUrl } from '../../shell/photo'
import { Page } from '../../shell/Page'
import { Avatar, Checkbox, ErrorState, IconButton, LinkButton, LoadingState, Menu, Ring, Tabs } from '../../ui'
import { formatHours, formatMoney, moneyInput, percentOf } from '../../work/format'
import { downloadCsv } from '../../work/csv'
import { Amounts } from '../../work/parts'
import { PeriodBar, usePeriod } from '../../work/Period'
import { useQuery } from '../../work/query'
import { ShareBar } from '../../work/ShareBar'
import { NewReportMenu, ReportsNav } from './ReportsNav'
import { type ReportColumn, ReportTable } from './ReportTable'
import { SaveReport } from './SaveReport'
import '../../work/work.css'
import './reports.css'

interface GroupInfo {
  id: 'byClient' | 'byProject' | 'byTask' | 'byPerson'
  label: string
  /** Where a name leads, for those who may go there. */
  path?: string
  needs?: PermissionKey
  /** What the detailed report calls it. */
  filter: string
}

const groups: GroupInfo[] = [
  { id: 'byClient', label: 'Clients', path: '/clients', needs: 'clients.view', filter: 'clients' },
  { id: 'byProject', label: 'Projects', path: '/projects', filter: 'projects' },
  { id: 'byTask', label: 'Tasks', filter: 'tasks' },
  { id: 'byPerson', label: 'Teammates', filter: 'people' },
]

export function ReportsPage() {
  const period = usePeriod('week')
  const { start, end } = period.range
  const { get, change } = useQuery()
  const department = get('department')
  const query = new URLSearchParams({ from: start, to: end, ...(get('active') && { active: '1' }), ...(get('fixed') && { fixed: '1' }), ...(department && { department }) })
  const { status, data, error, reload } = useLoad<TimeReport>(`reports/time?${query}`)
  const departments = data?.departments ?? (department ? [department] : [])
  return (
    <Page title="Reports" actions={<NewReportMenu />}>
      <ReportsNav current="/reports" />
      <div className="report-bar no-print">
        {departments.length > 0 && (
          <Menu
            label={department || 'All departments'}
            items={['', ...departments].map((name) => ({ id: name || 'all', label: name || 'All departments', checked: name === department, onSelect: () => change({ department: name }) }))}
          />
        )}
        <PeriodBar period={period} />
        <div className="report-save">
          <SaveReport />
        </div>
      </div>
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the report" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && <Report report={data} />}
    </Page>
  )
}

function Report({ report }: { report: TimeReport }) {
  const can = useCan()
  const { get, change } = useQuery()
  const { from, to, minutes, billableMinutes, showAmounts, amounts, uninvoiced, scope } = report
  const percent = percentOf(billableMinutes, minutes)
  const department = get('department')
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
        <div className="report-amount">
          <p>Billable amount</p>
          <p className="report-figure">{showAmounts ? <Amounts amounts={amounts} exact /> : 'N/A'}</p>
          {showAmounts && (
            <>
              <Checkbox label="Include Fixed Fee projects" checked={get('fixed') !== ''} onChange={(on) => change({ fixed: on ? '1' : null })} />
              <p className="report-note">Billable amounts for Fixed Fee projects are based on billable rates. The billable amount may not match the invoiced amount.</p>
            </>
          )}
        </div>
        <div className="report-amount">
          <p>Uninvoiced amount</p>
          <p className="report-figure">{showAmounts ? <Amounts amounts={uninvoiced} exact /> : 'N/A'}</p>
          {showAmounts && <p className="report-note">With billable expenses. Excludes Fixed Fee projects</p>}
        </div>
      </div>
      <Tabs
        label="Hours by"
        value={get('tab') || 'byClient'}
        onChange={(tab) => change({ tab: tab === 'byClient' ? null : tab })}
        items={groups
          .filter(({ id }) => scope === 'team' || id !== 'byPerson')
          .map((group) => {
            const { id, label, path, needs, filter } = group
            return {
              id,
              label,
              content: (
                <div className="stack">
                  <div className="report-tools no-print">
                    <Checkbox label="Active projects only" checked={get('active') !== ''} onChange={(on) => change({ active: on ? '1' : null })} />
                    <LinkButton size="small" to={`/reports/detailed?from=${from}&to=${to}`}>
                      Detailed report
                    </LinkButton>
                    <Menu
                      label="Export"
                      size="small"
                      align="end"
                      items={[
                        { id: 'csv', label: 'CSV', disabled: report[id].length === 0, onSelect: () => download(label, report[id], report) },
                        { id: 'print', label: 'Print or save as PDF', onSelect: () => window.print() },
                      ]}
                    />
                    <IconButton size="small" variant="secondary" icon="printer" label="Print" onClick={() => window.print()} />
                  </div>
                  <Group
                    title={label}
                    rows={report[id]}
                    report={report}
                    people={id === 'byPerson'}
                    path={path && (!needs || can(needs)) ? path : undefined}
                    detail={department ? undefined : (row) => `/reports/detailed?from=${from}&to=${to}&${filter}=${row}`}
                  />
                </div>
              ),
            }
          })}
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
  people: boolean
  path: string | undefined
  /** Where the hours of a row are listed. */
  detail?: (id: number) => string
}

function Group({ title, rows, report, people, path, detail }: GroupProps) {
  const most = Math.max(1, ...rows.map(({ minutes }) => minutes))
  const nameOf = ({ id, name, sub }: ReportRow) => {
    const to = people ? detail?.(id) : path && `${path}/${id}`
    return (
      <>
        {to ? <Link to={to}>{name}</Link> : name}
        {sub && <span className="muted"> ({sub})</span>}
      </>
    )
  }
  const columns: ReportColumn<ReportRow>[] = [
    {
      id: 'name', header: 'Name', value: ({ name }) => name,
      cell: (row) =>
        people ? (
          <span className="team-member">
            <Avatar name={row.name} src={photoUrl(row.photoId ?? null)} size="small" decorative />
            {nameOf(row)}
          </span>
        ) : (
          nameOf(row)
        ),
    },
    {
      id: 'hours', header: 'Hours', numeric: true, value: ({ minutes }) => minutes, total: formatHours(report.minutes),
      cell: ({ id, name, minutes }) =>
        detail ? (
          <Link to={detail(id)} aria-label={`${formatHours(minutes)} hours of ${name}`}>
            {formatHours(minutes)}
          </Link>
        ) : (
          formatHours(minutes)
        ),
    },
    { id: 'share', header: '', bar: true, cell: ({ minutes, billableMinutes }) => <ShareBar billable={billableMinutes} minutes={minutes} most={most} /> },
    ...(people
      ? [{
          id: 'utilization', header: 'Utilization', numeric: true, value: (row: ReportRow) => percentOf(row.minutes, row.capacityMinutes ?? 0),
          cell: (row: ReportRow) => (row.capacityMinutes ? `${percentOf(row.minutes, row.capacityMinutes)}%` : <span className="muted">-</span>),
        }]
      : []),
    {
      id: 'billable', header: 'Billable hours', numeric: true, value: ({ billableMinutes }) => billableMinutes, total: formatHours(report.billableMinutes),
      cell: ({ minutes, billableMinutes }) => (
        <>
          {formatHours(billableMinutes)} <span className="muted report-percent">({percentOf(billableMinutes, minutes)}%)</span>
        </>
      ),
    },
    ...(report.showAmounts
      ? [{
          id: 'amount', header: 'Billable amount', numeric: true, value: (row: ReportRow) => row.amount ?? 0, total: totals(report.amounts),
          cell: ({ amount, currency }: ReportRow) => (amount === null || currency === undefined ? <span className="muted">-</span> : <strong>{formatMoney(amount, currency)}</strong>),
        }]
      : []),
  ]
  return <ReportTable label={title} columns={columns} rows={rows} />
}

function download(title: string, rows: ReportRow[], { from, to }: TimeReport) {
  downloadCsv(`${title.toLowerCase()} ${from} to ${to}`, [
    ['Name', 'Client', 'Hours', 'Billable hours', 'Amount', 'Currency'],
    ...rows.map(({ name, sub, minutes, billableMinutes, amount, currency }) => [
      name, sub ?? '', (minutes / 60).toFixed(2), (billableMinutes / 60).toFixed(2), amount === null ? '' : moneyInput(amount, currency ?? 'USD'), amount === null ? '' : (currency ?? ''),
    ]),
  ])
}
