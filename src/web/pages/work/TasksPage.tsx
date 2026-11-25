import { type FormEvent, useId, useState } from 'react'
import type { TaskRow } from '../../../shared/work'
import { callApi } from '../../api'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Badge, Button, Checkbox, Dialog, Table, type TableColumn, TextField, useToast } from '../../ui'
import '../../work/work.css'

const columns: TableColumn<TaskRow>[] = [
  {
    id: 'name',
    header: 'Task',
    cell: ({ name, archived }) => (
      <span className="badges">
        <span className="strong">{name}</span> {archived && <Badge>Archived</Badge>}
      </span>
    ),
    sortValue: ({ name }) => name,
  },
  { id: 'billable', header: 'Billing', cell: ({ billable }) => (billable ? 'Billable' : <span className="muted">Non-billable</span>), sortValue: ({ billable }) => (billable ? 0 : 1) },
  { id: 'projects', header: 'Active projects', numeric: true, cell: ({ projects }) => projects, sortValue: ({ projects }) => projects },
]

export function TasksPage() {
  const { status, data, error, reload, setData } = useLoad<{ tasks: TaskRow[] }>('tasks')
  const [creating, setCreating] = useState(false)
  const toast = useToast()
  const tasks = data?.tasks ?? []
  const table = (caption: string, rows: TaskRow[]) => (
    <Table
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={({ id }) => String(id)}
      rowLabel={({ name }) => name}
      status={status}
      error={error}
      onRetry={reload}
      empty={{ icon: 'tasks', title: 'No tasks', description: 'There are none here.' }}
    />
  )
  return (
    <Page
      title="Tasks"
      actions={
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New task
        </Button>
      }
    >
      {table('Common tasks, added to new projects', tasks.filter(({ common }) => common))}
      {status === 'ready' && table('Other tasks', tasks.filter(({ common }) => !common))}
      {creating && (
        <NewTask
          onClose={() => setCreating(false)}
          onCreated={(next) => {
            setData(next)
            setCreating(false)
            toast.success('Task created')
          }}
        />
      )}
    </Page>
  )
}

const fields = ['name'] as const

function NewTask({ onClose, onCreated }: { onClose: () => void; onCreated: (next: { tasks: TaskRow[] }) => void }) {
  const formId = useId()
  const form = useForm('task', fields)
  const [name, setName] = useState('')
  const [billable, setBillable] = useState(true)
  const [common, setCommon] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => onCreated(await callApi<{ tasks: TaskRow[] }>('POST', 'tasks', { name, billable, common })),
      { name: name.trim() === '' ? 'Enter a name.' : null },
    )
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="New task"
      closeOnOutsidePress={false}
      busy={form.busy}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={form.busy} loadingLabel="Creating the task">
            Create task
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" noValidate onSubmit={submit}>
        <FormMessages form={form} />
        <TextField label="Name" required value={name} onChange={setName} {...form.field('name')} />
        <Checkbox label="Billable" checked={billable} onChange={setBillable} />
        <Checkbox label="Add to new projects" checked={common} onChange={setCommon} />
      </form>
    </Dialog>
  )
}
