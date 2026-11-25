import { useState } from 'react'
import type { ReportRow, TimeReport } from '../../../shared/work'
import { productName } from '../../../shared/product'
import { usePerson, useWeekStart } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { BarChart, Button, Card, type DateRange, DateRangePicker, ErrorState, formatDate, Legend, LoadingState, Meter, monthNames, partsOf, presetRange, StatTile, Table, type TableColumn, Tabs } from '../../ui'
import { formatAmounts, formatDecimalHours, formatHours, formatMoney, percentOf } from '../../work/format'
import { Amounts, hourSeries } from '../../work/parts'
import '../../work/work.css'

const groups = [
  { id: 'byClient', label: 'Clients', one: 'Client' },
  { id: 'byProject', label: 'Projects', one: 'Project' },
  { id: 'byTask', label: 'Tasks', one: 'Task' },
  { id: 'byPerson', label: 'People', one: 'Person' },
] as const

function todayIn(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return parts.slice(0, 10)
}

export function ReportsPage() {
  const { timeZone } = usePerson()
  const weekStart = useWeekStart()
  const today = todayIn(timeZone)
  const [range, setRange] = useState<DateRange>(() => presetRange('this-month', today, weekStart))
  const { status, data, error, reload } = useLoad<TimeReport>(`reports/time?from=${range.start}&to=${range.end}`)
  return (
    <Page title="Reports" description={data?.scope === 'own' ? 'Your own hours.' : 'Hours and what they are worth.'}>
      <div className="report-head">
        <DateRangePicker label="Dates" weekStart={weekStart} value={range} onChange={setRange} today={today} />
      </div>
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the report" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && <Report report={data} />}
    </Page>
  )
}

function Report({ report }: { report: TimeReport }) {
  const { minutes, billableMinutes, amounts, byDay, scope } = report
  const showAmounts = amounts.length > 0
  return (
    <>
      <div className="tiles">
        <StatTile label="Hours" value={formatHours(minutes)} detail={`${formatDate(report.from)} to ${formatDate(report.to)}`} />
        <StatTile label="Billable" value={`${percentOf(billableMinutes, minutes)}%`} detail={`${formatHours(billableMinutes)} hours`} />
        {showAmounts && <StatTile label="Billable amount" value={<Amounts amounts={amounts} />} detail="hours billed at their rates" />}
      </div>
      <Card title="Hours over time" actions={<Legend series={hourSeries} />}>
        <BarChart
          label="Hours over time"
          series={hourSeries}
          unit={60}
          format={formatDecimalHours}
          everyLabel={Math.max(1, Math.ceil(byDay.length / 10))}
          points={byDay.map(({ from, billable, other }) => {
            const { month, day } = partsOf(from)
            return { id: from, label: `${monthNames[month - 1]?.slice(0, 3)} ${day}`, title: formatDate(from), values: [billable, other] }
          })}
        />
      </Card>
      <Tabs
        label="Hours by"
        items={groups
          .filter(({ id }) => scope === 'team' || id !== 'byPerson')
          .map(({ id, label, one }) => ({ id, label, content: <Group key={id} title={label} one={one} rows={report[id]} total={minutes} showAmounts={showAmounts} report={report} /> }))}
      />
    </>
  )
}

interface GroupProps {
  title: string
  one: string
  rows: ReportRow[]
  total: number
  showAmounts: boolean
  report: TimeReport
}

function Group({ title, one, rows, total, showAmounts, report }: GroupProps) {
  const columns: TableColumn<ReportRow>[] = [
    {
      id: 'name',
      header: one,
      cell: ({ name, sub }) => (
        <span className="cell-two">
          <span className="strong">{name}</span>
          {sub && <span className="cell-sub">{sub}</span>}
        </span>
      ),
      sortValue: ({ name }) => name,
    },
    { id: 'share', header: 'Share', cell: ({ minutes }) => <Meter percent={percentOf(minutes, rows[0]?.minutes ?? 0)} /> },
    { id: 'hours', header: 'Hours', numeric: true, cell: ({ minutes }) => formatHours(minutes), sortValue: ({ minutes }) => minutes, total: formatHours(total) },
    {
      id: 'billable',
      header: 'Billable',
      numeric: true,
      cell: ({ minutes, billableMinutes }) => `${percentOf(billableMinutes, minutes)}%`,
      sortValue: ({ minutes, billableMinutes }) => percentOf(billableMinutes, minutes),
      total: `${percentOf(report.billableMinutes, total)}%`,
    },
    ...(showAmounts
      ? [{
          id: 'amount',
          header: 'Amount',
          numeric: true,
          cell: ({ amount, currency }: ReportRow) => (amount === null || currency === undefined ? <span className="muted">-</span> : formatMoney(amount, currency)),
          sortValue: ({ amount }: ReportRow) => amount ?? -1,
          total: formatAmounts(report.amounts),
        }]
      : []),
  ]
  return (
    <div className="stack">
      <div className="panel-head">
        <p className="muted">{rows.length} in this period</p>
        <Button icon="arrowDown" aria-disabled={rows.length === 0 || undefined} onClick={() => download(title, one, rows, report)}>
          Download CSV
        </Button>
      </div>
      <Table
        caption={title}
        hideCaption
        columns={columns}
        rows={rows}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        empty={{ icon: 'reports', title: 'No hours', description: 'Nothing was tracked in this period.' }}
      />
    </div>
  )
}

/** A spreadsheet would run a text that begins like a formula. */
const cellText = (value: string | number) => {
  const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function download(title: string, one: string, rows: ReportRow[], { from, to }: TimeReport) {
  const lines = [
    [one, 'Of', 'Hours', 'Billable hours', 'Amount', 'Currency'],
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
