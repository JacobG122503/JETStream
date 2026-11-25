import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ProjectDetails, ProjectOptions, ProjectPersonRow, ProjectTaskRow } from '../../../shared/work'
import { callApi } from '../../api'
import { useCan } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { photoUrl } from '../../shell/photo'
import { Page } from '../../shell/Page'
import { Avatar, Badge, BarChart, Button, Card, ErrorState, formatDate, Legend, LinkButton, LoadingState, Menu, Meter, monthNames, partsOf, Ring, StatTile, Table, type TableColumn } from '../../ui'
import { formatDecimalHours, formatHours, formatMoney, percentOf } from '../../work/format'
import { FormDialog } from '../../work/FormDialog'
import { hourSeries } from '../../work/parts'
import { useActions } from '../../work/useActions'
import '../../work/work.css'

const types = { time_materials: 'By the hour', fixed_fee: 'Fixed fee', non_billable: 'Not billable' } as const

export function ProjectPage() {
  const { id = '' } = useParams()
  return <ProjectLoader key={id} id={id} />
}

function ProjectLoader({ id }: { id: string }) {
  const can = useCan()
  const { status, data, error, reload, refresh } = useLoad<ProjectDetails>(`projects/${encodeURIComponent(id)}`)
  const { ask, run, dialog } = useActions()
  const [copying, setCopying] = useState(false)
  const navigate = useNavigate()
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
            {data.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </span>
        )
      }
      actions={
        <>
          <LinkButton to="/projects" icon="chevronLeft">
            Projects
          </LinkButton>
          {data && (
            <Button aria-pressed={data.pinned} onClick={() => void run('POST', `projects/${data.id}/pin`, { pin: !data.pinned }, data.pinned ? 'Unpinned' : 'Pinned to the top of your list', refresh)}>
              {data.pinned ? 'Unpin' : 'Pin'}
            </Button>
          )}
          {data?.canEdit && (
            <>
              <Menu
                label="More"
                items={[
                  ...(can('projects.create') ? [{ id: 'copy', label: 'Duplicate', icon: 'copy' as const, onSelect: () => setCopying(true) }] : []),
                  {
                    id: 'archive',
                    label: data.archived ? 'Restore' : 'Archive',
                    onSelect: () =>
                      ask({
                        title: data.archived ? 'Restore this project?' : 'Archive this project?', message: data.archived ? 'Time can be logged on it again.' : 'Its history stays. Nobody can log time on it.',
                        confirmLabel: data.archived ? 'Restore' : 'Archive', route: `projects/${data.id}/archive`, body: { archive: !data.archived },
                        done: data.archived ? 'Project restored' : 'Project archived', then: refresh,
                      }),
                  },
                  {
                    id: 'delete',
                    label: 'Delete',
                    destructive: true,
                    onSelect: () =>
                      ask({
                        title: 'Delete this project?', message: 'Its tasks, team and milestones go with it. Only a project without time, expenses and invoices can be deleted.', confirmLabel: 'Delete project',
                        destructive: true, method: 'DELETE', route: `projects/${data.id}`, done: 'Project deleted', then: () => navigate('/projects'),
                      }),
                  },
                ]}
              />
              {!data.archived && (
                <LinkButton to={`/projects/${data.id}/edit`} icon="edit">
                  Edit
                </LinkButton>
              )}
            </>
          )}
        </>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the project" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error === 'Not found' ? 'There is no such project.' : error} onRetry={reload} />}
      {data && <Project project={data} />}
      {data && copying && <Duplicate project={data} onClose={() => setCopying(false)} />}
      {dialog}
    </Page>
  )
}

function Duplicate({ project, onClose }: { project: ProjectDetails; onClose: () => void }) {
  const { data } = useLoad<ProjectOptions>('projects/options')
  const navigate = useNavigate()
  if (!data) return null
  return (
    <FormDialog
      title="Duplicate project"
      submitLabel="Make a copy"
      intro={<p className="muted">Settings, tasks and budget are copied. Time, expenses and invoices are not.</p>}
      initial={{ clientId: project.client.id, name: `${project.name} (copy)`, code: '' }}
      fields={[
        { name: 'clientId', label: 'Client', type: 'combo', required: true, options: data.clients.map(({ id, name }) => ({ value: String(id), label: name })) },
        { name: 'name', label: 'Name', type: 'text', required: true, half: true },
        { name: 'code', label: 'Code', type: 'text', half: true },
        { name: 'withTeam', label: 'Copy the team', type: 'check' },
      ]}
      onClose={onClose}
      onSubmit={async (values) => {
        const { id } = await callApi<{ id: number }>('POST', `projects/${project.id}/duplicate`, values)
        navigate(`/projects/${id}`)
        onClose()
      }}
    />
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
            unit={60}
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
