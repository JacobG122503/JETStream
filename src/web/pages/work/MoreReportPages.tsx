import { Link } from 'react-router-dom'
import type { ContractorReport, ProfitReport, ProfitRow, SavedReport } from '../../../shared/work'
import { useLoad } from '../../auth/useLoad'
import { photoUrl } from '../../shell/photo'
import { Page } from '../../shell/Page'
import { Avatar, Button, Checkbox, EmptyState, ErrorState, formatDate, IconButton, LoadingState, Notice, StatTile, Table, Tabs } from '../../ui'
import { downloadCsv } from '../../work/csv'
import { formatAmounts, formatHours, formatMoney, moneyInput, percentOf } from '../../work/format'
import { PeriodBar, usePeriod } from '../../work/Period'
import { useQuery } from '../../work/query'
import { useActions } from '../../work/useActions'
import { NewReportMenu, ReportsNav } from './ReportsNav'
import { type ReportColumn, ReportTable } from './ReportTable'
import { SaveReport } from './SaveReport'
import '../../work/work.css'
import './reports.css'

const profitGroups = [
  { id: 'byClient', label: 'Clients' },
  { id: 'byProject', label: 'Projects' },
  { id: 'byPerson', label: 'Team' },
  { id: 'byTask', label: 'Tasks' },
] as const

export function ProfitabilityPage() {
  const period = usePeriod('month')
  const { start, end } = period.range
  const { get, change } = useQuery()
  const fixed = get('fixed') !== ''
  const { status, data, error, reload } = useLoad<ProfitReport>(`reports/profitability?from=${start}&to=${end}${fixed ? '&fixed=1' : ''}`)
  return (
    <Page title="Profitability" actions={<NewReportMenu />}>
      <ReportsNav current="/reports/profitability" />
      <div className="report-bar no-print">
        <PeriodBar period={period} />
        <div className="report-save">
          <SaveReport />
        </div>
      </div>
      <Checkbox
        label="Include Fixed Fee projects"
        hint="Their revenue is then based on billable rates and may not match the invoiced amount."
        checked={fixed}
        onChange={(on) => change({ fixed: on ? '1' : null })}
      />
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the report" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="tiles">
            <StatTile label="Revenue" value={formatMoney(data.revenue, data.currency)} detail={`${formatHours(data.minutes)} hours`} />
            <StatTile label="Costs" value={formatMoney(data.cost, data.currency)} detail="by cost rates" />
            <StatTile label="Profit" value={formatMoney(data.revenue - data.cost, data.currency)} detail={`margin ${percentOf(data.revenue - data.cost, data.revenue)}%`} />
          </div>
          {data.otherCurrencyMinutes > 0 && <Notice>{formatHours(data.otherCurrencyMinutes)} hours are left out, because the client has another currency than the company.</Notice>}
          {data.withoutCostMinutes > 0 && <Notice tone="warning">{formatHours(data.withoutCostMinutes)} hours count without a cost, because the person has no cost rate.</Notice>}
          <Tabs
            label="Profit by"
            value={get('tab') || 'byClient'}
            onChange={(tab) => change({ tab: tab === 'byClient' ? null : tab })}
            items={profitGroups.map(({ id, label }) => ({
              id,
              label,
              content: (
                <div className="stack">
                  <div className="report-tools no-print">
                    <Button
                      size="small"
                      aria-disabled={data[id].length === 0 || undefined}
                      onClick={() =>
                        downloadCsv(`profitability ${label.toLowerCase()} ${start} to ${end}`, [
                          ['Name', 'Client', 'Hours', 'Revenue', 'Costs', 'Profit', 'Currency'],
                          ...data[id].map(({ name, sub, minutes, revenue, cost }) => [
                            name, sub ?? '', (minutes / 60).toFixed(2), moneyInput(revenue, data.currency), moneyInput(cost, data.currency), moneyInput(revenue - cost, data.currency), data.currency,
                          ]),
                        ])
                      }
                    >
                      Export CSV
                    </Button>
                    <IconButton size="small" variant="secondary" icon="printer" label="Print" onClick={() => window.print()} />
                  </div>
                  <ReportTable label={label} rows={data[id]} columns={profitColumns(data)} />
                </div>
              ),
            }))}
          />
        </>
      )}
    </Page>
  )
}

function profitColumns({ currency, minutes, revenue, cost }: ProfitReport): ReportColumn<ProfitRow>[] {
  const money = (amount: number) => formatMoney(amount, currency)
  return [
    { id: 'name', header: 'Name', value: ({ name }) => name, cell: ({ name, sub }) => <>{name}{sub && <span className="muted"> ({sub})</span>}</> },
    { id: 'hours', header: 'Hours', numeric: true, value: (row) => row.minutes, cell: (row) => formatHours(row.minutes), total: formatHours(minutes) },
    { id: 'revenue', header: 'Revenue', numeric: true, value: (row) => row.revenue, cell: (row) => money(row.revenue), total: money(revenue) },
    { id: 'cost', header: 'Costs', numeric: true, value: (row) => row.cost, cell: (row) => money(row.cost), total: money(cost) },
    { id: 'profit', header: 'Profit', numeric: true, value: (row) => row.revenue - row.cost, cell: (row) => <strong>{money(row.revenue - row.cost)}</strong>, total: money(revenue - cost) },
    {
      id: 'margin', header: 'Margin', numeric: true, value: (row) => percentOf(row.revenue - row.cost, row.revenue),
      cell: (row) => (row.revenue === 0 ? <span className="muted">-</span> : `${percentOf(row.revenue - row.cost, row.revenue)}%`), total: revenue === 0 ? '' : `${percentOf(revenue - cost, revenue)}%`,
    },
  ]
}

export function ContractorPage() {
  const period = usePeriod('month')
  const { start, end } = period.range
  const { status, data, error, reload } = useLoad<ContractorReport>(`reports/contractors?from=${start}&to=${end}`)
  const rows = data?.rows ?? []
  const spent = (row: ContractorReport['rows'][number]) => row.expenses.reduce((sum, { amount }) => sum + amount, 0)
  const sum = (value: (row: ContractorReport['rows'][number]) => number) => rows.reduce((total, row) => total + value(row), 0)
  const currencies = [...new Set(rows.flatMap(({ expenses }) => expenses.map(({ currency }) => currency)))]
  const allSpent = currencies.map((currency) => ({ currency, amount: sum((row) => row.expenses.find((one) => one.currency === currency)?.amount ?? 0) }))
  return (
    <Page title="Contractor report" actions={<NewReportMenu />}>
      <ReportsNav current="/reports/contractors" />
      <div className="report-bar no-print">
        <PeriodBar period={period} />
        <div className="report-save">
          <SaveReport />
        </div>
      </div>
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the report" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && (
        <ReportTable
          label="Contractors"
          rows={rows}
          columns={[
            {
              id: 'name', header: 'Name', value: ({ name }) => name,
              cell: ({ id, name, photoId }) => (
                <span className="team-member">
                  <Avatar name={name} src={photoUrl(photoId)} size="small" decorative />
                  <Link to={`/reports/detailed?from=${start}&to=${end}&people=${id}`}>{name}</Link>
                </span>
              ),
            },
            { id: 'hours', header: 'Hours', numeric: true, value: ({ minutes }) => minutes, cell: ({ minutes }) => formatHours(minutes), total: formatHours(sum(({ minutes }) => minutes)) },
            { id: 'billable', header: 'Billable hours', numeric: true, value: (row) => row.billableMinutes, cell: (row) => formatHours(row.billableMinutes), total: formatHours(sum((row) => row.billableMinutes)) },
            ...(data.showCosts
              ? [{
                  id: 'cost', header: 'Costs', numeric: true, value: (row: (typeof rows)[number]) => row.cost ?? 0,
                  cell: (row: (typeof rows)[number]) => (row.cost === null ? <span className="muted">-</span> : formatMoney(row.cost, data.currency)), total: formatMoney(sum(({ cost }) => cost ?? 0), data.currency),
                }]
              : []),
            { id: 'expenses', header: 'Expenses', numeric: true, value: spent, cell: ({ expenses }) => formatAmounts(expenses), total: formatAmounts(allSpent) },
          ]}
        />
      )}
    </Page>
  )
}

export function SavedReportsPage() {
  const { status, data, error, reload, setData } = useLoad<{ reports: SavedReport[] }>('reports/saved')
  const { ask, dialog } = useActions()
  return (
    <Page title="Saved reports" actions={<NewReportMenu />}>
      <ReportsNav current="/reports/saved" />
      {data?.reports.length === 0 ? (
        <EmptyState icon="reports" headingLevel={2} title="No saved reports" description="Open a report, choose what it shows, and press Save report. Only you see what you saved." />
      ) : (
        <Table
          caption="Saved reports"
          hideCaption
          status={status}
          error={error}
          onRetry={reload}
          rows={data?.reports ?? []}
          rowKey={({ id }) => String(id)}
          rowLabel={({ name }) => name}
          columns={[
            { id: 'name', header: 'Name', cell: ({ name, path }) => <Link to={path}>{name}</Link>, sortValue: ({ name }) => name },
            { id: 'saved', header: 'Saved', nowrap: true, cell: ({ createdAt }) => formatDate(createdAt.slice(0, 10)), sortValue: ({ createdAt }) => createdAt },
          ]}
          rowActions={({ id, name }) => (
            <IconButton
              size="small"
              variant="quiet"
              icon="trash"
              label={`Delete ${name}`}
              onClick={() =>
                ask({ title: `Delete ${name}?`, message: 'Only what you saved is deleted. Time, expenses and invoices stay.', confirmLabel: 'Delete', destructive: true, method: 'DELETE', route: `reports/saved/${id}`, done: 'Deleted', then: setData })
              }
            />
          )}
        />
      )}
      {dialog}
    </Page>
  )
}
