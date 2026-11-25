import { type FormEvent, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { ProjectDetails, ProjectOptions } from '../../../shared/work'
import { callApi } from '../../api'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Button, Card, Checkbox, Combobox, ErrorState, IconButton, LinkButton, LoadingState, Notice, TextField, useToast } from '../../ui'
import { Fields, type FieldSpec, useFields } from '../../work/FormDialog'
import { hoursInput, moneyInput, parseHours, parseMoney } from '../../work/format'
import '../../work/work.css'

export function ProjectEditPage() {
  const { id = '' } = useParams()
  return <Loader key={id} id={id} />
}

function Loader({ id }: { id: string }) {
  const { status, data, error, reload, setData } = useLoad<ProjectDetails>(`projects/${encodeURIComponent(id)}`)
  const options = useLoad<ProjectOptions>('projects/options')
  return (
    <Page
      title={data ? `Edit ${data.name}` : 'Edit project'}
      actions={
        <LinkButton to={`/projects/${id}`} icon="chevronLeft">
          Project
        </LinkButton>
      }
    >
      {(status === 'loading' || options.status === 'loading') && <LoadingState size="page" look="skeleton" label="Loading the project" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error === 'Not found' ? 'There is no such project.' : error} onRetry={reload} />}
      {data && !data.canEdit && <Notice>You can look at this project, but not change it.</Notice>}
      {data && options.data && data.canEdit && (
        <>
          <Settings key={`settings ${data.version}`} project={data} onSaved={setData} onReload={reload} />
          <Tasks key={`tasks ${JSON.stringify(data.tasks.map((task) => [task.id, task.removed]))}`} project={data} options={options.data} onSaved={setData} />
          <Team key={`team ${JSON.stringify(data.people.map((person) => [person.id, person.removed, person.isManager]))}`} project={data} options={options.data} onSaved={setData} />
        </>
      )}
    </Page>
  )
}

interface PartProps {
  project: ProjectDetails
  onSaved: (project: ProjectDetails) => void
}

function Settings({ project, onSaved, onReload }: PartProps & { onReload: () => void }) {
  const toast = useToast()
  const { currency, canEditMoney } = project
  const hourly = (values: Record<string, unknown>) => values.type === 'time_materials'
  const fields: FieldSpec[] = [
    { name: 'name', label: 'Name', type: 'text', required: true, half: true },
    { name: 'code', label: 'Code', type: 'text', half: true },
    { name: 'startsOn', label: 'Starts', type: 'date', half: true },
    { name: 'endsOn', label: 'Ends', type: 'date', half: true },
    {
      name: 'type', label: 'Billing', type: 'select', disabled: !canEditMoney, half: true,
      options: [
        { value: 'time_materials', label: 'Time and materials' },
        { value: 'fixed_fee', label: 'Fixed fee' },
        { value: 'non_billable', label: 'Non-billable' },
      ],
    },
    { name: 'fixedFee', label: 'Fee', type: 'money', currency, required: true, show: ({ type }) => type === 'fixed_fee' && canEditMoney, half: true },
    {
      name: 'rateMethod', label: 'Rates', type: 'select', disabled: !canEditMoney, half: true, show: ({ type }) => type !== 'non_billable',
      options: [
        { value: 'project', label: 'One rate for the project' },
        { value: 'task', label: 'A rate for each task' },
        { value: 'person', label: 'A rate for each person' },
        { value: 'none', label: 'No rates' },
      ],
    },
    { name: 'rate', label: 'Hourly rate', type: 'money', currency, required: true, show: (values) => hourly(values) && values.rateMethod === 'project' && canEditMoney, half: true },
    {
      name: 'budgetType', label: 'Budget', type: 'select', half: true,
      options: [
        { value: 'none', label: 'No budget' },
        { value: 'total_hours', label: 'Total hours' },
        { value: 'hours_per_task', label: 'Hours per task' },
        { value: 'hours_per_person', label: 'Hours per person' },
        { value: 'total_fees', label: 'Total fees', disabled: !canEditMoney },
        { value: 'fees_per_task', label: 'Fees per task', disabled: !canEditMoney },
      ],
    },
    { name: 'budgetMinutes', label: 'Budget, hours', type: 'hours', required: true, show: ({ budgetType }) => budgetType === 'total_hours', half: true },
    { name: 'budgetAmount', label: 'Budget', type: 'money', currency, required: true, show: ({ budgetType }) => budgetType === 'total_fees' && canEditMoney, half: true },
    { name: 'budgetAlertPercent', label: 'Alert at, percent', type: 'percent', show: ({ budgetType }) => budgetType !== 'none' },
    { name: 'budgetMonthly', label: 'The budget starts over each month', type: 'check', show: ({ budgetType }) => budgetType !== 'none' },
    { name: 'budgetIncludesExpenses', label: 'Billable expenses count', type: 'check', show: ({ budgetType }) => budgetType === 'total_fees' },
    { name: 'budgetVisibleToAll', label: 'Everyone on the project sees the budget', type: 'check', show: ({ budgetType }) => budgetType !== 'none' },
    { name: 'tags', label: 'Tags', type: 'names', hint: 'Separated by commas.' },
    { name: 'notes', label: 'Notes', type: 'area' },
  ]
  const { form, values, setValues, submit } = useFields('project', fields, { ...project })
  const save = (event: FormEvent) => {
    event.preventDefault()
    void submit(async (result) => {
      // Who may not see amounts sends back what is not shown as it is.
      const kept = canEditMoney ? {} : { type: project.type, rateMethod: project.rateMethod, rate: project.rate ?? null, fixedFee: project.fixedFee ?? null, budgetAmount: project.budgetAmount ?? null }
      onSaved(await callApi<ProjectDetails>('PUT', `projects/${project.id}`, { ...(result as object), ...kept, version: project.version }))
      toast.success('Project saved')
    })
  }
  return (
    <Card title="Settings">
      <form className="stack" noValidate onSubmit={save}>
        <FormMessages form={form} onReload={onReload} />
        <Fields fields={fields} values={values} onChange={setValues} field={form.field} />
        <p className="form-note">Changing rates changes what hours are worth that are not invoiced yet. Invoiced amounts stay.</p>
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving the project">
            Save project
          </Button>
        </div>
      </form>
    </Card>
  )
}

interface TaskDraft {
  taskId: number
  name: string
  billable: boolean
  rate: string
  hours: string
  amount: string
}

const none: readonly string[] = []

function Tasks({ project, options, onSaved }: PartProps & { options: ProjectOptions }) {
  const toast = useToast()
  const form = useForm('tasks', none)
  const { currency, canEditMoney, rateMethod, budgetType, type } = project
  const [rows, setRows] = useState<TaskDraft[]>(() =>
    project.tasks
      .filter(({ removed }) => !removed)
      .map(({ id, name, billable, rate, budgetMinutes, budgetAmount }) => ({
        taskId: id, name, billable, rate: rate ? moneyInput(rate, currency) : '', hours: budgetMinutes ? hoursInput(budgetMinutes) : '', amount: budgetAmount ? moneyInput(budgetAmount, currency) : '',
      })),
  )
  const change = (taskId: number, part: Partial<TaskDraft>) => setRows((before) => before.map((row) => (row.taskId === taskId ? { ...row, ...part } : row)))
  const withRate = canEditMoney && rateMethod === 'task' && type !== 'non_billable'
  const save = (event: FormEvent) => {
    event.preventDefault()
    const bad = rows.some(({ rate, hours, amount }) => (rate && parseMoney(rate, currency) === null) || (hours && parseHours(hours) === null) || (amount && parseMoney(amount, currency) === null))
    void form.submit(
      async () => {
        const tasks = rows.map(({ taskId, billable, rate, hours, amount }) => ({
          taskId, billable, rate: rate ? parseMoney(rate, currency) : null, budgetMinutes: (hours && parseHours(hours)) || null, budgetAmount: (amount && parseMoney(amount, currency)) || null,
        }))
        onSaved(await callApi<ProjectDetails>('PUT', `projects/${project.id}/tasks`, { tasks }))
        toast.success('Tasks saved')
      },
      bad ? { row: 'Check the rates and budgets.' } : {},
    )
  }
  return (
    <Card title="Tasks">
      <form className="stack" noValidate onSubmit={save}>
        <FormMessages form={form} />
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Tasks of the project">
          <table className="edit-table">
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Billable</th>
                {withRate && <th scope="col">Rate ({currency})</th>}
                {budgetType === 'hours_per_task' && <th scope="col">Budget, hours</th>}
                {budgetType === 'fees_per_task' && canEditMoney && <th scope="col">Budget ({currency})</th>}
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.taskId}>
                  <th scope="row">{row.name}</th>
                  <td>
                    <Checkbox label={`${row.name} is billable`} hideLabel checked={row.billable} disabled={type === 'non_billable'} onChange={(billable) => change(row.taskId, { billable })} />
                  </td>
                  {withRate && (
                    <td>
                      <TextField label={`Rate for ${row.name}`} hideLabel inputMode="decimal" value={row.rate} onChange={(rate) => change(row.taskId, { rate })} />
                    </td>
                  )}
                  {budgetType === 'hours_per_task' && (
                    <td>
                      <TextField label={`Hours for ${row.name}`} hideLabel inputMode="decimal" value={row.hours} onChange={(hours) => change(row.taskId, { hours })} />
                    </td>
                  )}
                  {budgetType === 'fees_per_task' && canEditMoney && (
                    <td>
                      <TextField label={`Budget for ${row.name}`} hideLabel inputMode="decimal" value={row.amount} onChange={(amount) => change(row.taskId, { amount })} />
                    </td>
                  )}
                  <td>
                    <IconButton icon="close" size="small" variant="quiet" label={`Remove ${row.name}`} onClick={() => setRows((before) => before.filter(({ taskId }) => taskId !== row.taskId))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <Notice tone="warning">Without tasks, nobody can log time on this project.</Notice>}
        <Combobox
          label="Add a task"
          placeholder="Search tasks"
          value={null}
          options={options.tasks.filter(({ id }) => !rows.some(({ taskId }) => taskId === id)).map(({ id, name }) => ({ value: String(id), label: name }))}
          onChange={(value) => {
            const task = options.tasks.find(({ id }) => String(id) === value)
            if (task) setRows((before) => [...before, { taskId: task.id, name: task.name, billable: task.billable && type !== 'non_billable', rate: '', hours: '', amount: '' }])
          }}
        />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving tasks">
            Save tasks
          </Button>
        </div>
      </form>
    </Card>
  )
}

interface MemberDraft {
  personId: number
  name: string
  isManager: boolean
  rate: string
  hours: string
}

function Team({ project, options, onSaved }: PartProps & { options: ProjectOptions }) {
  const toast = useToast()
  const form = useForm('team', none)
  const { currency, canEditMoney, rateMethod, budgetType, type, canManageFlags } = project
  const [rows, setRows] = useState<MemberDraft[]>(() =>
    project.people
      .filter(({ removed }) => !removed)
      .map(({ id, name, isManager, rate, budgetMinutes }) => ({ personId: id, name, isManager, rate: rate ? moneyInput(rate, currency) : '', hours: budgetMinutes ? hoursInput(budgetMinutes) : '' })),
  )
  const change = (personId: number, part: Partial<MemberDraft>) => setRows((before) => before.map((row) => (row.personId === personId ? { ...row, ...part } : row)))
  const withRate = canEditMoney && rateMethod === 'person' && type !== 'non_billable'
  const save = (event: FormEvent) => {
    event.preventDefault()
    const bad = rows.some(({ rate, hours }) => (rate && parseMoney(rate, currency) === null) || (hours && parseHours(hours) === null))
    void form.submit(
      async () => {
        const members = rows.map(({ personId, isManager, rate, hours }) => ({ personId, isManager, rate: rate ? parseMoney(rate, currency) : null, budgetMinutes: (hours && parseHours(hours)) || null }))
        onSaved(await callApi<ProjectDetails>('PUT', `projects/${project.id}/team`, { members }))
        toast.success('Team saved')
      },
      bad ? { row: 'Check the rates and budgets.' } : {},
    )
  }
  return (
    <Card title="Team">
      <form className="stack" noValidate onSubmit={save}>
        <FormMessages form={form} />
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Team of the project">
          <table className="edit-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Manages</th>
                {withRate && <th scope="col">Rate ({currency})</th>}
                {budgetType === 'hours_per_person' && <th scope="col">Budget, hours</th>}
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.personId}>
                  <th scope="row">{row.name}</th>
                  <td>
                    <Checkbox label={`${row.name} manages the project`} hideLabel checked={row.isManager} disabled={!canManageFlags} onChange={(isManager) => change(row.personId, { isManager })} />
                  </td>
                  {withRate && (
                    <td>
                      <TextField label={`Rate of ${row.name}`} hideLabel placeholder="Own rate" inputMode="decimal" value={row.rate} onChange={(rate) => change(row.personId, { rate })} />
                    </td>
                  )}
                  {budgetType === 'hours_per_person' && (
                    <td>
                      <TextField label={`Hours of ${row.name}`} hideLabel inputMode="decimal" value={row.hours} onChange={(hours) => change(row.personId, { hours })} />
                    </td>
                  )}
                  <td>
                    <IconButton
                      icon="close"
                      size="small"
                      variant="quiet"
                      label={`Remove ${row.name}`}
                      disabled={row.isManager && !canManageFlags}
                      onClick={() => setRows((before) => before.filter(({ personId }) => personId !== row.personId))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Combobox
          label="Add a person"
          placeholder="Search people"
          value={null}
          options={options.people.filter(({ id }) => !rows.some(({ personId }) => personId === id)).map(({ id, name }) => ({ value: String(id), label: name }))}
          onChange={(value) => {
            const person = options.people.find(({ id }) => String(id) === value)
            if (person) setRows((before) => [...before, { personId: person.id, name: person.name, isManager: false, rate: '', hours: '' }])
          }}
        />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving the team">
            Save team
          </Button>
        </div>
      </form>
    </Card>
  )
}
