import { Link, useParams } from 'react-router-dom'
import type { ProjectDetails, ProjectPersonRow, ProjectTaskRow } from '../../../shared/work'
import { useCan } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { photoUrl } from '../../shell/photo'
import { Page } from '../../shell/Page'
import { Avatar, Badge, BarChart, Card, ErrorState, formatDate, Legend, LinkButton, LoadingState, Meter, monthNames, partsOf, Ring, StatTile, Table, type TableColumn } from '../../ui'
import { formatDecimalHours, formatHours, formatMoney, percentOf } from '../../work/format'
import { hourSeries } from '../../work/parts'
import '../../work/work.css'

const types = { time_materials: 'By the hour', fixed_fee: 'Fixed fee', non_billable: 'Not billable' } as const

export function ProjectPage() {
  const { id = '' } = useParams()
  return <ProjectLoader key={id} id={id} />
}

function ProjectLoader({ id }: { id: string }) {
  const can = useCan()
  const { status, data, error, reload } = useLoad<ProjectDetails>(`projects/${encodeURIComponent(id)}`)
  return (
    <Page
      title={data?.name ?? 'Project'}
      description={
        data && (
          <span className="facts-line">
            {can('clients.view') ? <Link to={`/clients/${data.client.id}`}>{data.client.name}</Link> : <span>{data.client.name}</span>}
            {data.code && <span>{data.code}</span>}
            <span>{types[data.type]}</span>
            {data.startsOn && (
              <span>
                {formatDate(data.startsOn)}
                {data.endsOn ? ` to ${formatDate(data.endsOn)}` : ''}
              </span>
            )}
            {data.archived && <Badge>Archived</Badge>}
          </span>
        )
      }
      actions={
        <LinkButton to="/projects" icon="chevronLeft">
          Projects
        </LinkButton>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the project" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error === 'Not found' ? 'There is no such project.' : error} onRetry={reload} />}
      {data && <Project project={data} />}
    </Page>
  )
}

function Project({ project }: { project: ProjectDetails }) {
  const { currency, budget, minutes, billableMinutes, weeks, billableAmount, unbilledAmount, fixedFee, type } = project
  const money = (amount: number) => formatMoney(amount, currency, { whole: true })
  const percent = budget ? percentOf(budget.used, budget.total) : 0
  const amount = (value: number) => (budget?.unit === 'fees' ? money(value) : formatHours(value))
  const hourly = type === 'time_materials'

  const taskColumns: TableColumn<ProjectTaskRow>[] = [
    {
      id: 'name',
      header: 'Task',
      cell: ({ name, billable }) => (
        <span className="cell-two">
          <span className="strong">{name}</span>
          {!billable && <span className="cell-sub">Not billable</span>}
        </span>
      ),
      sortValue: ({ name }) => name,
    },
    { id: 'share', header: 'Share', cell: (row) => <Meter percent={row.budgetMinutes ? percentOf(row.minutes, row.budgetMinutes) : percentOf(row.minutes, minutes)} over={row.budgetMinutes !== null && row.minutes > row.budgetMinutes} /> },
    {
      id: 'hours',
      header: 'Hours',
      numeric: true,
      cell: ({ minutes: worked, budgetMinutes }) => (budgetMinutes ? `${formatHours(worked)} of ${formatHours(budgetMinutes)}` : formatHours(worked)),
      sortValue: ({ minutes: worked }) => worked,
    },
    ...(hourly && billableAmount !== undefined
      ? [{ id: 'amount', header: 'Amount', numeric: true, cell: (row: ProjectTaskRow) => money(row.billableAmount ?? 0), sortValue: (row: ProjectTaskRow) => row.billableAmount ?? 0 }]
      : []),
  ]
  const teamColumns: TableColumn<ProjectPersonRow>[] = [
    {
      id: 'name',
      header: 'Person',
      cell: ({ name, photoId, isManager }) => (
        <span className="person-cell">
          <Avatar name={name} src={photoUrl(photoId)} size="small" decorative />
          <span className="strong">{name}</span> {isManager && <Badge tone="info">Manager</Badge>}
        </span>
      ),
      sortValue: ({ name }) => name,
    },
    { id: 'share', header: 'Share', cell: (row) => <Meter percent={row.budgetMinutes ? percentOf(row.minutes, row.budgetMinutes) : percentOf(row.minutes, minutes)} over={row.budgetMinutes !== null && row.minutes > row.budgetMinutes} /> },
    {
      id: 'hours',
      header: 'Hours',
      numeric: true,
      cell: ({ minutes: worked, budgetMinutes }) => (budgetMinutes ? `${formatHours(worked)} of ${formatHours(budgetMinutes)}` : formatHours(worked)),
      sortValue: ({ minutes: worked }) => worked,
    },
    ...(hourly && billableAmount !== undefined
      ? [{ id: 'amount', header: 'Amount', numeric: true, cell: (row: ProjectPersonRow) => money(row.billableAmount ?? 0), sortValue: (row: ProjectPersonRow) => row.billableAmount ?? 0 }]
      : []),
  ]

  return (
    <>
      <div className="tiles">
        <StatTile label="Hours" value={formatHours(minutes)} detail={`${percentOf(billableMinutes, minutes)}% billable`} />
        {hourly && billableAmount !== undefined && <StatTile label="Billable amount" value={money(billableAmount)} detail="all hours at their rates" />}
        {hourly && unbilledAmount !== undefined && <StatTile label="Not invoiced yet" value={money(unbilledAmount)} detail="ready to bill" />}
        {fixedFee !== undefined && fixedFee !== null && <StatTile label="Fixed fee" value={money(fixedFee)} detail="agreed with the client" />}
        {project.rate !== undefined && project.rate !== null && <StatTile label="Hourly rate" value={formatMoney(project.rate, currency)} detail="for the whole project" />}
      </div>
      <div className={budget ? 'columns columns-wide' : 'stack'}>
        <Card title="Hours per week" actions={<Legend series={hourSeries} />}>
          <BarChart
            label="Hours per week"
            series={hourSeries}
            format={formatDecimalHours}
            everyLabel={2}
            points={weeks.map(({ from, billable, other }, index) => {
              const { month, day } = partsOf(from)
              return { id: from, label: `${monthNames[month - 1]?.slice(0, 3)} ${day}`, title: `Week of ${formatDate(from)}`, values: [billable, other], current: index === weeks.length - 1 }
            })}
          />
        </Card>
        {budget && (
          <Card title={budget.monthly ? 'Budget this month' : 'Budget'}>
            <div className="budget-card">
              <Ring percent={percent} size="large" label={`${percent}% of the budget used`}>
                <strong>{percent}%</strong>
                <span>used</span>
              </Ring>
              <dl className="budget-facts">
                <dt>Used</dt>
                <dd>{amount(budget.used)}</dd>
                <dt>{budget.used > budget.total ? 'Over by' : 'Left'}</dt>
                <dd className={budget.used > budget.total ? 'budget-over' : undefined}>{amount(Math.abs(budget.total - budget.used))}</dd>
                <dt>Budget</dt>
                <dd>{amount(budget.total)}</dd>
              </dl>
            </div>
          </Card>
        )}
      </div>
      <div className="columns">
        <Table caption="Tasks" columns={taskColumns} rows={project.tasks} rowKey={({ id }) => String(id)} rowLabel={({ name }) => name} empty={{ title: 'No tasks', description: 'No tasks are on this project.' }} />
        <Table caption="Team" columns={teamColumns} rows={project.people} rowKey={({ id }) => String(id)} rowLabel={({ name }) => name} empty={{ title: 'Nobody', description: 'Nobody is on this project.' }} />
      </div>
    </>
  )
}
