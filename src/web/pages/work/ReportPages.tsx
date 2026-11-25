import { Fragment, type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DetailedTime, ExpenseReport, InvoiceList, InvoiceRow, PaymentReport, ProjectRow, ReportOption, ReportOptions, UnbilledClient } from '../../../shared/work'
import { useWeekStart } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import {
  Badge, Button, Checkbox, DatePicker, type DateRange, formatDate, formatNumericDate, IconButton, isIsoDate, Menu, MultiCombobox, presetRange, type RangePresetId, rangePresets, Select, StatTile, Table,
  type TableColumn,
} from '../../ui'
import { methodLabels } from '../../work/billing'
import { downloadCsv } from '../../work/csv'
import { formatAmounts, formatHours, formatMoney, moneyInput } from '../../work/format'
import { BudgetBar } from '../../work/parts'
import { PeriodBar, usePeriod, useToday } from '../../work/Period'
import { useQuery } from '../../work/query'
import { SubNav } from '../../work/SubNav'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'
import { NewReportMenu, ReportsNav } from './ReportsNav'
import { SaveReport } from './SaveReport'
import '../../work/work.css'
import './reports.css'

type Csv = (string | number)[][]

interface FrameProps {
  title: string
  path: string
  children: ReactNode
  csv: () => Csv
  name: string
  empty: boolean
}

const invoicing = [
  { to: '/reports/invoices', label: 'Invoices' },
  { to: '/reports/payments', label: 'Payments' },
  { to: '/reports/uninvoiced', label: 'Uninvoiced' },
]

function Frame({ title, path, children, csv, name, empty }: FrameProps) {
  return (
    <Page
      title={title}
      actions={
        <>
          <Button icon="printer" onClick={() => window.print()}>
            Print
          </Button>
          <Button aria-disabled={empty || undefined} onClick={() => !empty && downloadCsv(name, csv())}>
            Export CSV
          </Button>
        </>
      }
    >
      <ReportsNav current={invoicing.some(({ to }) => to === path) ? '/reports/invoices' : path} />
      {invoicing.some(({ to }) => to === path) && (
        <div className="no-print">
          <SubNav label="Invoicing" current={path} items={invoicing} />
        </div>
      )}
      {children}
    </Page>
  )
}

function sums<T extends { currency: string }>(rows: readonly T[], value: (row: T) => number) {
  const found = new Map<string, number>()
  for (const row of rows) found.set(row.currency, (found.get(row.currency) ?? 0) + value(row))
  return [...found].map(([currency, amount]) => ({ currency, amount }))
}

const yes = (value: boolean) => (value ? 'Yes' : 'No')
const distinct = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b))

interface Filter<T> {
  id: string
  label: string
  valueOf: (row: T) => string
}

/** Choices to look at a part of the rows. */
function useFilters<T>(rows: readonly T[], filters: readonly Filter<T>[]) {
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const shown = rows.filter((row) => filters.every(({ id, valueOf }) => !chosen[id] || valueOf(row) === chosen[id]))
  const bar = (
    <div className="filters no-print">
      {filters.map(({ id, label, valueOf }) => (
        <Select
          key={id}
          label={label}
          value={chosen[id] ?? ''}
          options={[{ value: '', label: 'All' }, ...distinct(rows.map(valueOf)).map((value) => ({ value, label: value }))]}
          onChange={(value) => setChosen((before) => ({ ...before, [id]: value }))}
        />
      ))}
    </div>
  )
  return { shown, bar }
}

type Line = { clientId: number; projectId: number; personId: number; tagIds: number[]; billable: boolean; spentOn: string }
type Choice = { id: string; label: string; plural: string; options: ReportOption[]; has: (value: number) => boolean }

const timeframes = [...rangePresets.map(({ id, label }) => ({ value: id as string, label })), { value: 'custom', label: 'Custom' }]

/** The dates of a detailed report, kept in the address: a named timeframe stays current. */
function useTimeframe(first: RangePresetId) {
  const { get, change } = useQuery()
  const today = useToday()
  const weekStart = useWeekStart()
  const [from, to] = [get('from'), get('to')]
  const custom = isIsoDate(from) && isIsoDate(to) && from <= to
  const preset = rangePresets.find(({ id }) => id === get('timeframe'))?.id ?? first
  const range: DateRange = custom ? { start: from, end: to } : presetRange(preset, today, weekStart)
  return {
    range, weekStart, today, value: custom ? 'custom' : preset,
    choose: (value: string) =>
      value === 'custom' ? change({ timeframe: null, from: range.start, to: range.end }) : change({ timeframe: value === first ? null : value, from: null, to: null }),
    setRange: ({ start, end }: DateRange) => change({ timeframe: null, from: start, to: end }),
  }
}

interface DetailedProps<T extends Line> {
  title: string
  path: string
  frame: ReturnType<typeof useTimeframe>
  options: ReportOptions | undefined
  rows: readonly T[]
  /** Between projects and teammates. */
  third: { id: 'tasks' | 'categories'; label: string; valueOf: (row: T) => number }
  children: (rows: T[], tools: (csv: () => Csv) => ReactNode) => ReactNode
  sums: (rows: T[]) => ReactNode
}

/** A list of everything of a timeframe, with what it can be filtered by. */
function Detailed<T extends Line>({ title, path, frame, options, rows, third, children, sums: figures }: DetailedProps<T>) {
  const { get, list, change } = useQuery()
  const [shown, setShown] = useState(true)
  const { range, weekStart, today } = frame
  const archived = get('archived') !== ''
  const billable = get('billable')
  const choices: (Choice & { valuesOf: (row: T) => number[] })[] = (
    [
      ['clients', 'Clients', (row: T) => [row.clientId]],
      ['projects', 'Projects', (row: T) => [row.projectId]],
      [third.id, third.label, (row: T) => [third.valueOf(row)]],
      ['people', 'Teammates', (row: T) => [row.personId]],
      ['tags', 'Tags', (row: T) => row.tagIds],
    ] as const
  ).map(([id, label, valuesOf]) => {
    const chosen = list(id).map(Number)
    return { id, label, plural: label.toLowerCase(), options: options?.[id] ?? [], has: (value: number) => chosen.length === 0 || chosen.includes(value), valuesOf }
  })
  const found = rows.filter(
    (row) => choices.every(({ id, has, valuesOf }) => list(id).length === 0 || valuesOf(row).some(has)) && (billable === '' || row.billable === (billable === 'yes')),
  )
  const dates = `${formatNumericDate(range.start)} – ${formatNumericDate(range.end)}`
  const tools = (csv: () => Csv) => (
    <div className="report-tools no-print">
      <SaveReport />
      <Menu
        label="Export"
        align="end"
        items={[
          { id: 'csv', label: 'CSV', disabled: found.length === 0, onSelect: () => downloadCsv(`${title.toLowerCase()} ${range.start} to ${range.end}`, csv()) },
          { id: 'print', label: 'Print or save as PDF', onSelect: () => window.print() },
        ]}
      />
      <IconButton variant="secondary" icon="printer" label="Print" onClick={() => window.print()} />
    </div>
  )
  return (
    <Page
      title={title}
      titleMore={`: ${dates}`}
      actions={
        <>
          <NewReportMenu label={path === '/reports/expenses' ? 'Expense Report' : 'Time Report'} current={path} />
          <Button aria-expanded={shown} onClick={() => setShown(!shown)}>
            {shown ? 'Hide filters' : 'Show filters'}
          </Button>
        </>
      }
    >
      {shown && (
        <div className="report-filters no-print" role="group" aria-label="Filters">
          <span aria-hidden="true">Timeframe</span>
          <div className="stack">
            <Select label="Timeframe" hideLabel className="report-timeframe" value={frame.value} options={timeframes} onChange={frame.choose} />
            {frame.value === 'custom' && (
              <div className="report-dates">
                <DatePicker label="Start date" weekStart={weekStart} today={today} max={range.end} value={range.start} onChange={(start) => start && frame.setRange({ ...range, start })} />
                <span aria-hidden="true">to</span>
                <DatePicker label="End date" weekStart={weekStart} today={today} min={range.start} value={range.end} onChange={(end) => end && frame.setRange({ ...range, end })} />
              </div>
            )}
            <Checkbox label="Include archived items in filters" checked={archived} onChange={(on) => change({ archived: on ? '1' : null })} />
          </div>
          {choices.map(({ id, label, plural, options: all }) => (
            <Fragment key={id}>
              <span aria-hidden="true">{label}</span>
              <MultiCombobox
                label={label}
                hideLabel
                placeholder={`All ${plural}`}
                value={list(id)}
                options={all
                  .filter((option) => archived || !option.archived || list(id).includes(String(option.id)))
                  .map((option) => ({ value: String(option.id), label: option.archived ? `${option.name} (archived)` : option.name }))}
                onChange={(value) => change({ [id]: value })}
              />
            </Fragment>
          ))}
          <span aria-hidden="true">Billable</span>
          <Select
            label="Billable"
            hideLabel
            value={billable}
            options={[{ value: '', label: 'Billable and non-billable' }, { value: 'yes', label: 'Billable only' }, { value: 'no', label: 'Non-billable only' }]}
            onChange={(value) => change({ billable: value })}
          />
        </div>
      )}
      <div className="report-head">
        <div>{figures(found)}</div>
        <ul className="report-chosen" aria-label="Chosen">
          {choices.map(({ id, plural, options: all }) => {
            const names = list(id).map((value) => all.find((option) => String(option.id) === value)?.name ?? '')
            return <li key={id}>{names.length === 0 ? `All ${plural}` : names.join(', ')}</li>
          })}
        </ul>
      </div>
      {children(found, tools)}
    </Page>
  )
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p>{label}</p>
      <p className="report-figure">{children}</p>
    </div>
  )
}

type TimeLine = DetailedTime['rows'][number]

export function DetailedTimePage() {
  const frame = useTimeframe('this-week')
  const { start, end } = frame.range
  const { status, data, error, reload } = useLoad<DetailedTime>(`reports/detailed?from=${start}&to=${end}`)
  const money = data?.showAmounts === true
  const columns: TableColumn<TimeLine>[] = [
    { id: 'date', header: 'Date', nowrap: true, cell: ({ spentOn }) => formatDate(spentOn), sortValue: ({ spentOn }) => spentOn },
    { id: 'project', header: 'Project', cell: ({ project, client }) => <span className="cell-two"><span className="strong">{project}</span><span className="cell-sub">{client}</span></span>, sortValue: ({ project }) => project },
    { id: 'task', header: 'Task', cell: ({ task, notes }) => <span className="cell-two"><span>{task}</span><span className="cell-sub">{notes}</span></span>, sortValue: ({ task }) => task },
    { id: 'person', header: 'Teammate', cell: ({ person }) => person, sortValue: ({ person }) => person },
    { id: 'hours', header: 'Hours', numeric: true, cell: (row) => formatHours(row.minutes), sortValue: (row) => row.minutes },
    ...(money ? [{ id: 'amount', header: 'Amount', numeric: true, cell: ({ amount, currency }: TimeLine) => (amount === null ? <span className="muted">-</span> : formatMoney(amount, currency)), sortValue: ({ amount }: TimeLine) => amount ?? 0 }] : []),
    { id: 'invoiced', header: 'Invoiced', cell: ({ billable, invoiced }) => (!billable ? <span className="muted">Non-billable</span> : invoiced ? <Badge tone="success">Invoiced</Badge> : <Badge>Open</Badge>) },
  ]
  return (
    <Detailed
      title="Detailed time report"
      path="/reports/detailed"
      frame={frame}
      options={data?.options}
      rows={data?.rows ?? []}
      third={{ id: 'tasks', label: 'Tasks', valueOf: ({ taskId }) => taskId }}
      sums={(shown) => (
        <>
          <Figure label="Total hours">{formatHours(shown.reduce((sum, { minutes }) => sum + minutes, 0))}</Figure>
          <Figure label="Billable hours">{formatHours(shown.filter(({ billable }) => billable).reduce((sum, { minutes }) => sum + minutes, 0))}</Figure>
          {money && <Figure label="Billable amount">{formatAmounts(sums(shown, ({ amount }) => amount ?? 0))}</Figure>}
        </>
      )}
    >
      {(shown, tools) => (
        <>
          {tools(() => [
            ['Date', 'Client', 'Project', 'Task', 'Person', 'Notes', 'Hours', 'Billable', 'Invoiced', ...(money ? ['Amount', 'Currency'] : [])],
            ...shown.map((row) => [row.spentOn, row.client, row.project, row.task, row.person, row.notes, (row.minutes / 60).toFixed(2), yes(row.billable), yes(row.invoiced), ...(money ? [row.amount === null ? '' : moneyInput(row.amount, row.currency), row.currency] : [])]),
          ])}
          <Table caption="Detailed time" hideCaption status={status} error={error} onRetry={reload} rows={shown} rowKey={({ id }) => String(id)} rowLabel={({ spentOn, project }) => `${spentOn}, ${project}`} columns={columns} empty={{ icon: 'time', title: 'No time', description: 'Nothing was tracked that fits.' }} />
        </>
      )}
    </Detailed>
  )
}

type ExpenseLine = ExpenseReport['rows'][number]

const expenseColumns: TableColumn<ExpenseLine>[] = [
  { id: 'date', header: 'Date', nowrap: true, cell: ({ spentOn }) => formatDate(spentOn), sortValue: ({ spentOn }) => spentOn },
  { id: 'category', header: 'Category', cell: ({ category, notes }) => <span className="cell-two"><span className="strong">{category}</span><span className="cell-sub">{notes}</span></span>, sortValue: ({ category }) => category },
  { id: 'project', header: 'Project', cell: ({ project, client }) => <span className="cell-two"><span>{project}</span><span className="cell-sub">{client}</span></span>, sortValue: ({ project }) => project },
  { id: 'person', header: 'Teammate', cell: ({ person }) => person, sortValue: ({ person }) => person },
  { id: 'invoiced', header: 'Invoiced', cell: ({ billable, invoiced }) => (!billable ? <span className="muted">Non-billable</span> : invoiced ? <Badge tone="success">Invoiced</Badge> : <Badge>Open</Badge>) },
  { id: 'amount', header: 'Amount', numeric: true, cell: ({ amount, currency }) => formatMoney(amount, currency), sortValue: ({ amount }) => amount },
]

export function ExpenseReportPage() {
  const frame = useTimeframe('this-week')
  const { start, end } = frame.range
  const { status, data, error, reload } = useLoad<ExpenseReport>(`reports/expenses?from=${start}&to=${end}`)
  return (
    <Detailed
      title="Detailed expense report"
      path="/reports/expenses"
      frame={frame}
      options={data?.options}
      rows={data?.rows ?? []}
      third={{ id: 'categories', label: 'Categories', valueOf: ({ categoryId }) => categoryId }}
      sums={(shown) => (
        <>
          <Figure label="Total expenses">{formatAmounts(sums(shown, ({ amount }) => amount))}</Figure>
          <Figure label="Billable expenses">{formatAmounts(sums(shown.filter(({ billable }) => billable), ({ amount }) => amount))}</Figure>
        </>
      )}
    >
      {(shown, tools) => (
        <>
          {tools(() => [
            ['Date', 'Client', 'Project', 'Category', 'Person', 'Notes', 'Amount', 'Currency', 'Billable', 'Invoiced', 'Paying back'],
            ...shown.map((row) => [row.spentOn, row.client, row.project, row.category, row.person, row.notes, moneyInput(row.amount, row.currency), row.currency, yes(row.billable), yes(row.invoiced), row.reimbursementStatus]),
          ])}
          <Table caption="Expenses" hideCaption status={status} error={error} onRetry={reload} rows={shown} rowKey={({ id }) => String(id)} rowLabel={({ spentOn, category }) => `${spentOn}, ${category}`} columns={expenseColumns} empty={{ icon: 'expenses', title: 'No expenses', description: 'Nothing was entered that fits.' }} />
        </>
      )}
    </Detailed>
  )
}

export function BudgetReportPage() {
  const { status, data, error, reload } = useLoad<{ projects: ProjectRow[] }>('projects')
  const rows = (data?.projects ?? []).filter(({ archived, budget }) => !archived && budget !== null)
  return (
    <Frame
      title="Project budgets"
      path="/reports/budgets"
      name="project budgets"
      empty={rows.length === 0}
      csv={() => [
        ['Client', 'Project', 'Unit', 'Used', 'Budget', 'Percent', 'Currency'],
        ...rows.map(({ client, name, budget, currency }) => {
          const value = (amount: number) => (budget?.unit === 'hours' ? (amount / 60).toFixed(2) : moneyInput(amount, currency))
          return [client.name, name, budget?.unit ?? '', value(budget?.used ?? 0), value(budget?.total ?? 0), Math.round(((budget?.used ?? 0) / (budget?.total || 1)) * 100), budget?.unit === 'hours' ? '' : currency]
        }),
      ]}
    >
      <Table
        caption="Project budgets"
        hideCaption
        status={status}
        error={error}
        onRetry={reload}
        rows={rows}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        columns={[
          { id: 'project', header: 'Project', cell: ({ id, name, client }) => <span className="cell-two"><Link to={`/projects/${id}`}>{name}</Link><span className="cell-sub">{client.name}</span></span>, sortValue: ({ name }) => name },
          { id: 'budget', header: 'Budget', cell: (project) => <BudgetBar project={project} />, sortValue: ({ budget }) => (budget ? budget.used / budget.total : 0) },
        ]}
        empty={{ icon: 'projects', title: 'No budgets', description: 'No active project that you see has a budget.' }}
      />
    </Frame>
  )
}

export function UninvoicedReportPage() {
  const { status, data, error, reload } = useLoad<{ clients: UnbilledClient[] }>('invoices/unbilled?from=&to=')
  const rows = (data?.clients ?? []).flatMap((client) => client.projects.map((project) => ({ ...project, client })))
  return (
    <Frame
      title="Uninvoiced"
      path="/reports/uninvoiced"
      name="uninvoiced"
      empty={rows.length === 0}
      csv={() => [
        ['Client', 'Project', 'Hours', 'Time amount', 'Expenses', 'Currency'],
        ...rows.map(({ client, name, minutes, timeAmount, expenseAmount }) => [client.name, name, (minutes / 60).toFixed(2), moneyInput(timeAmount, client.currency), moneyInput(expenseAmount, client.currency), client.currency]),
      ]}
    >
      {data && (
        <div className="tiles">
          <StatTile label="Uninvoiced" value={formatAmounts(sums(data.clients, ({ total }) => total))} detail="hours and expenses" />
        </div>
      )}
      <Table
        caption="Uninvoiced"
        hideCaption
        status={status}
        error={error}
        onRetry={reload}
        rows={rows}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        columns={[
          { id: 'project', header: 'Project', cell: ({ id, name, client }) => <span className="cell-two"><Link to={`/projects/${id}`}>{name}</Link><span className="cell-sub">{client.name}</span></span>, sortValue: ({ name }) => name },
          { id: 'hours', header: 'Hours', numeric: true, cell: ({ minutes }) => formatHours(minutes), sortValue: ({ minutes }) => minutes },
          { id: 'time', header: 'Time', numeric: true, cell: ({ timeAmount, client }) => formatMoney(timeAmount, client.currency), sortValue: ({ timeAmount }) => timeAmount },
          { id: 'expenses', header: 'Expenses', numeric: true, cell: ({ expenseAmount, client }) => formatMoney(expenseAmount, client.currency), sortValue: ({ expenseAmount }) => expenseAmount },
          { id: 'missing', header: 'Without a rate', numeric: true, cell: ({ withoutRate }) => (withoutRate === 0 ? <span className="muted">-</span> : `${withoutRate} entries`) },
        ]}
        empty={{ icon: 'success', title: 'Everything is invoiced', description: 'There are no hours or expenses to bill.' }}
      />
    </Frame>
  )
}

const stateFilters: Filter<InvoiceRow>[] = [
  { id: 'client', label: 'Client', valueOf: ({ client }) => client.name },
  { id: 'status', label: 'Status', valueOf: ({ status, late }) => (late ? 'Late' : { draft: 'Draft', open: 'Open', paid: 'Paid', closed: 'Closed' }[status]) },
]

export function InvoiceReportPage() {
  const period = usePeriod('year')
  const { start, end } = period.range
  const { status, data, error, reload } = useLoad<InvoiceList>('invoices')
  const issued = (data?.invoices ?? []).filter(({ issuedOn }) => issuedOn >= start && issuedOn <= end)
  const { shown, bar } = useFilters(issued, stateFilters)
  const counted = shown.filter((invoice) => invoice.status !== 'draft')
  return (
    <Frame
      title="Invoices report"
      path="/reports/invoices"
      name={`invoices ${start} to ${end}`}
      empty={shown.length === 0}
      csv={() => [
        ['Number', 'Client', 'Subject', 'Status', 'Issued', 'Due', 'Total', 'Still due', 'Currency'],
        ...shown.map((row) => [row.number, row.client.name, row.subject, row.late ? 'late' : row.status, row.issuedOn, row.dueOn, moneyInput(row.total, row.currency), moneyInput(row.dueAmount, row.currency), row.currency]),
      ]}
    >
      <PeriodBar period={period} />
      {bar}
      {data && (
        <div className="tiles">
          <StatTile label="Invoiced" value={formatAmounts(sums(counted, ({ total }) => total))} detail="without drafts" />
          <StatTile label="Still due" value={formatAmounts(sums(counted.filter((invoice) => invoice.status === 'open'), ({ dueAmount }) => dueAmount))} />
        </div>
      )}
      <Table
        caption="Invoices"
        hideCaption
        status={status}
        error={error}
        onRetry={reload}
        rows={shown}
        rowKey={({ id }) => String(id)}
        rowLabel={({ number }) => number}
        columns={[
          { id: 'number', header: 'Invoice', cell: ({ id, number, subject }) => <span className="cell-two"><Link to={`/invoices/${id}`}>{number}</Link><span className="cell-sub">{subject}</span></span>, sortValue: ({ number }) => number },
          { id: 'client', header: 'Client', cell: ({ client }) => client.name, sortValue: ({ client }) => client.name },
          { id: 'status', header: 'Status', cell: (invoice) => <InvoiceStatusBadge invoice={invoice} />, sortValue: ({ status: is }) => is },
          { id: 'issued', header: 'Issued', nowrap: true, cell: ({ issuedOn }) => formatDate(issuedOn), sortValue: ({ issuedOn }) => issuedOn },
          { id: 'total', header: 'Total', numeric: true, cell: ({ total, currency }) => formatMoney(total, currency), sortValue: ({ total }) => total },
          { id: 'due', header: 'Still due', numeric: true, cell: ({ dueAmount, currency }) => formatMoney(dueAmount, currency), sortValue: ({ dueAmount }) => dueAmount },
        ]}
        empty={{ icon: 'invoices', title: 'No invoices', description: 'None were issued that fit.' }}
      />
    </Frame>
  )
}

const methodOf = (method: string) => (method in methodLabels ? methodLabels[method as keyof typeof methodLabels] : method)
const paymentFilters: Filter<PaymentReport['rows'][number]>[] = [
  { id: 'client', label: 'Client', valueOf: ({ client }) => client },
  { id: 'method', label: 'Method', valueOf: ({ method }) => methodOf(method) },
]

export function PaymentReportPage() {
  const period = usePeriod('year')
  const { start, end } = period.range
  const { status, data, error, reload } = useLoad<PaymentReport>(`reports/payments?from=${start}&to=${end}`)
  const { shown, bar } = useFilters(data?.rows ?? [], paymentFilters)
  return (
    <Frame
      title="Payments"
      path="/reports/payments"
      name={`payments ${start} to ${end}`}
      empty={shown.length === 0}
      csv={() => [
        ['Date', 'Invoice', 'Client', 'Method', 'Reference', 'Amount', 'Given back', 'Currency', 'Simulated'],
        ...shown.map((row) => [row.paidOn, row.invoice.number, row.client, methodOf(row.method), row.reference, moneyInput(row.amount, row.currency), moneyInput(row.refunded, row.currency), row.currency, yes(row.simulated)]),
      ]}
    >
      <PeriodBar period={period} />
      {bar}
      {data && (
        <div className="tiles">
          <StatTile label="Came in" value={formatAmounts(sums(shown, ({ amount, refunded }) => amount - refunded))} detail="less what was given back" />
        </div>
      )}
      <Table
        caption="Payments"
        hideCaption
        status={status}
        error={error}
        onRetry={reload}
        rows={shown}
        rowKey={({ id }) => String(id)}
        rowLabel={({ paidOn, invoice }) => `${paidOn}, ${invoice.number}`}
        columns={[
          { id: 'date', header: 'Date', nowrap: true, cell: ({ paidOn }) => formatDate(paidOn), sortValue: ({ paidOn }) => paidOn },
          { id: 'invoice', header: 'Invoice', cell: ({ invoice }) => <Link to={`/invoices/${invoice.id}`}>{invoice.number}</Link>, sortValue: ({ invoice }) => invoice.number },
          { id: 'client', header: 'Client', cell: ({ client }) => client, sortValue: ({ client }) => client },
          { id: 'method', header: 'Method', cell: ({ method, reference, simulated }) => <span className="cell-two"><span>{methodOf(method)}{simulated && ' (simulated)'}</span><span className="cell-sub">{reference}</span></span>, sortValue: ({ method }) => method },
          { id: 'amount', header: 'Amount', numeric: true, cell: ({ amount, refunded, currency }) => <span className="cell-two"><span>{formatMoney(amount, currency)}</span>{refunded > 0 && <span className="cell-sub">{formatMoney(refunded, currency)} given back</span>}</span>, sortValue: ({ amount }) => amount },
        ]}
        empty={{ icon: 'dollar', title: 'No payments', description: 'Nothing came in that fits.' }}
      />
    </Frame>
  )
}
