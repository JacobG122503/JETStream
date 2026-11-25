import { type FormEvent, useId, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ProjectOptions, ProjectRow } from '../../../shared/work'
import { callApi } from '../../api'
import { useCan } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Badge, Button, Combobox, Dialog, ErrorState, FilterBar, LoadingState, MultiCombobox, SearchField, Select, Table, type TableColumn, TextField, useToast } from '../../ui'
import { formatHours, parseHours, parseMoney, percentOf } from '../../work/format'
import { AvatarStack, BudgetBar } from '../../work/parts'
import '../../work/work.css'

// eslint-disable-next-line react-refresh/only-export-components -- used by the page of a client too
export const projectColumns: TableColumn<ProjectRow>[] = [
  {
    id: 'name',
    header: 'Project',
    cell: ({ id, name, code, client, archived }) => (
      <span className="cell-two">
        <span>
          <Link to={`/projects/${id}`}>{name}</Link> {archived && <Badge>Archived</Badge>}
        </span>
        <span className="cell-sub">{[client.name, code].filter(Boolean).join(', ')}</span>
      </span>
    ),
    sortValue: ({ name }) => name,
  },
  { id: 'team', header: 'Team', cell: ({ members }) => <AvatarStack people={members} />, sortValue: ({ members }) => members.length },
  {
    id: 'hours',
    header: 'Hours',
    numeric: true,
    cell: ({ minutes, billableMinutes }) => (
      <span className="cell-two">
        <span>{formatHours(minutes)}</span>
        <span className="cell-sub">{percentOf(billableMinutes, minutes)}% billable</span>
      </span>
    ),
    sortValue: ({ minutes }) => minutes,
  },
  {
    id: 'budget',
    header: 'Budget',
    cell: (project) => <BudgetBar project={project} />,
    sortValue: ({ budget }) => (budget ? budget.used / budget.total : -1),
  },
]

export function ProjectsPage() {
  const can = useCan()
  const { status, data, error, reload } = useLoad<{ projects: ProjectRow[] }>('projects')
  const [search, setSearch] = useState('')
  const [show, setShow] = useState('active')
  const [creating, setCreating] = useState(false)
  const rows = useMemo(() => {
    const wanted = search.trim().toLowerCase()
    return (data?.projects ?? []).filter(
      ({ name, code, client, archived }) => (show === 'all' || archived === (show === 'archived')) && `${name}\n${code}\n${client.name}`.toLowerCase().includes(wanted),
    )
  }, [data, search, show])

  return (
    <Page
      title="Projects"
      description="Hours, budgets and teams."
      actions={
        can('projects.create') && (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New project
          </Button>
        )
      }
    >
      <FilterBar label="Filter projects">
        <SearchField label="Search projects" hideLabel placeholder="Project, code or client" value={search} onChange={setSearch} />
        <Select
          label="Show"
          hideLabel
          value={show}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
            { value: 'all', label: 'All' },
          ]}
          onChange={setShow}
        />
      </FilterBar>
      <Table
        caption="Projects"
        hideCaption
        columns={projectColumns}
        rows={rows}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        status={status}
        error={error}
        onRetry={reload}
        empty={{ icon: 'projects', title: 'No projects', description: search ? 'No project has this name, code or client.' : 'There are no projects to show.' }}
      />
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </Page>
  )
}

const fields = ['clientId', 'name', 'code', 'type', 'rate', 'fixedFee', 'budgetMinutes', 'taskIds', 'personIds'] as const

function NewProject({ onClose }: { onClose: () => void }) {
  const formId = useId()
  const toast = useToast()
  const navigate = useNavigate()
  const { status, data, error, reload } = useLoad<ProjectOptions>('projects/options')
  const form = useForm('project', fields)
  const [clientId, setClientId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [type, setType] = useState('time_materials')
  const [rate, setRate] = useState('')
  const [fee, setFee] = useState('')
  const [budget, setBudget] = useState('')
  const [tasks, setTasks] = useState<string[] | null>(null)
  const [people, setPeople] = useState<string[]>([])
  const taskIds = tasks ?? (data?.tasks ?? []).filter(({ common }) => common).map(({ id }) => String(id))
  const currency = data?.clients.find(({ id }) => String(id) === clientId)?.currency ?? 'USD'
  const amount = (text: string) => (text.trim() === '' ? null : parseMoney(text, currency))
  const budgetMinutes = budget.trim() === '' ? null : parseHours(budget)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        const body = {
          clientId: Number(clientId), name, code, type, rate: type === 'time_materials' ? amount(rate) : null, fixedFee: type === 'fixed_fee' ? amount(fee) : null,
          budgetMinutes, taskIds: taskIds.map(Number), personIds: people.map(Number),
        }
        const { id } = await callApi<{ id: number }>('POST', 'projects', body)
        toast.success('Project created')
        navigate(`/projects/${id}`)
      },
      {
        clientId: clientId === null ? 'Choose a client.' : null,
        name: name.trim() === '' ? 'Enter a name.' : null,
        rate: rate.trim() !== '' && type === 'time_materials' && amount(rate) === null ? 'Enter an amount such as 125.00.' : null,
        fixedFee: type === 'fixed_fee' && amount(fee) === null ? 'Enter an amount such as 12000.00.' : null,
        budgetMinutes: budget.trim() !== '' && budgetMinutes === null ? 'Enter hours such as 120.' : null,
        taskIds: taskIds.length === 0 ? 'Choose at least one task.' : null,
      },
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New project"
      closeOnOutsidePress={false}
      busy={form.busy}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={form.busy} loadingLabel="Creating the project" aria-disabled={!data || undefined}>
            Create project
          </Button>
        </>
      }
    >
      {status === 'loading' && <LoadingState label="Loading choices" />}
      {status === 'error' && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <form id={formId} className="stack" noValidate onSubmit={submit}>
          <FormMessages form={form} />
          <Combobox
            label="Client"
            required
            placeholder="Search clients"
            value={clientId}
            options={data.clients.map(({ id, name: label }) => ({ value: String(id), label }))}
            onChange={setClientId}
            {...form.field('clientId')}
          />
          <div className="form-pair">
            <TextField label="Name" required value={name} onChange={setName} {...form.field('name')} />
            <TextField label="Code" value={code} onChange={setCode} {...form.field('code')} />
          </div>
          <div className="form-pair">
            <Select
              label="Billing"
              value={type}
              options={[
                { value: 'time_materials', label: 'By the hour' },
                { value: 'fixed_fee', label: 'Fixed fee', disabled: !data.money },
                { value: 'non_billable', label: 'Not billable' },
              ]}
              onChange={setType}
              {...form.field('type')}
            />
            {data.money && type === 'time_materials' && (
              <TextField label={`Hourly rate (${currency})`} inputMode="decimal" hint="Leave empty to use each person's own rate." value={rate} onChange={setRate} {...form.field('rate')} />
            )}
            {data.money && type === 'fixed_fee' && (
              <TextField label={`Fee (${currency})`} required inputMode="decimal" value={fee} onChange={setFee} {...form.field('fixedFee')} />
            )}
          </div>
          <TextField label="Budget in hours" inputMode="decimal" hint="Leave empty for no budget." value={budget} onChange={setBudget} {...form.field('budgetMinutes')} />
          <MultiCombobox
            label="Tasks"
            required
            placeholder="Search tasks"
            value={taskIds}
            options={data.tasks.map(({ id, name: label, billable }) => ({ value: String(id), label: billable ? label : `${label} (not billable)` }))}
            onChange={setTasks}
            {...form.field('taskIds')}
          />
          <MultiCombobox
            label="Team"
            hint="You are on the project, as its manager."
            placeholder="Search people"
            value={people}
            options={data.people.map(({ id, name: label }) => ({ value: String(id), label }))}
            onChange={setPeople}
            {...form.field('personIds')}
          />
        </form>
      )}
    </Dialog>
  )
}
