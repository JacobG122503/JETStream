import { useState } from 'react'
import type { TaskRow } from '../../../shared/work'
import { callApi } from '../../api'
import { useCan } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Badge, Button, Menu, Select, Table, type TableColumn, useToast } from '../../ui'
import { type FieldSpec, FormDialog } from '../../work/FormDialog'
import { formatMoney, getFormats } from '../../work/format'
import { useActions } from '../../work/useActions'
import '../../work/work.css'

interface Tasks {
  tasks: TaskRow[]
}

export function TasksPage() {
  const { status, data, error, reload, refresh, setData } = useLoad<Tasks>('tasks')
  const can = useCan()
  const [editing, setEditing] = useState<TaskRow | 'new' | null>(null)
  const [show, setShow] = useState('active')
  const { ask, run, dialog } = useActions()
  const toast = useToast()
  const { currency } = getFormats()
  const money = can('billable.view', 'all')
  const tasks = (data?.tasks ?? []).filter(({ archived }) => archived === (show === 'archived'))

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
    ...(money
      ? [{ id: 'rate', header: 'Default rate', numeric: true, cell: ({ defaultRate }: TaskRow) => (defaultRate ? formatMoney(defaultRate, currency) : '-'), sortValue: ({ defaultRate }: TaskRow) => defaultRate ?? 0 }]
      : []),
    { id: 'projects', header: 'Active projects', numeric: true, cell: ({ projects }) => projects, sortValue: ({ projects }) => projects },
  ]
  const actions = (task: TaskRow) => (
    <Menu
      label={`Actions for ${task.name}`}
      iconOnly
      align="end"
      size="small"
      items={[
        { id: 'edit', label: 'Edit', icon: 'edit', onSelect: () => setEditing(task) },
        {
          id: 'all', label: 'Add to all active projects', icon: 'plus', disabled: task.archived,
          onSelect: () =>
            ask({
              title: `Add ${task.name} to all active projects?`, message: 'Projects that have it stay as they are.', confirmLabel: 'Add to projects', route: `tasks/${task.id}/add-to-all`,
              done: 'Task added to projects', then: refresh,
            }),
        },
        { id: 'archive', label: task.archived ? 'Restore' : 'Archive', onSelect: () => void run('POST', `tasks/${task.id}/archive`, { archive: !task.archived }, task.archived ? 'Task restored' : 'Task archived', setData) },
        {
          id: 'delete', label: 'Delete', icon: 'trash', destructive: true,
          onSelect: () =>
            ask({
              title: `Delete ${task.name}?`, message: 'Only a task that no project uses can be deleted.', confirmLabel: 'Delete task', destructive: true, method: 'DELETE', route: `tasks/${task.id}`,
              done: 'Task deleted', then: setData,
            }),
        },
      ]}
    />
  )
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
      rowActions={actions}
      empty={{ icon: 'tasks', title: 'No tasks', description: 'There are none here.' }}
    />
  )
  const fields: FieldSpec[] = [
    { name: 'name', label: 'Name', type: 'text', required: true },
    ...(money ? [{ name: 'defaultRate', label: 'Default hourly rate', type: 'money' as const, currency, disabled: !can('billable.edit', 'all') }] : []),
    { name: 'billable', label: 'Billable', type: 'check' },
    { name: 'common', label: 'Add to new projects', type: 'check' },
  ]
  return (
    <Page
      title="Tasks"
      actions={
        <>
          <Select
            label="Show"
            hideLabel
            value={show}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
            ]}
            onChange={setShow}
          />
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            New task
          </Button>
        </>
      }
    >
      {table('Common tasks, added to new projects', tasks.filter(({ common }) => common))}
      {status === 'ready' && table('Other tasks', tasks.filter(({ common }) => !common))}
      {editing && (
        <FormDialog
          title={editing === 'new' ? 'New task' : 'Edit task'}
          submitLabel={editing === 'new' ? 'Create task' : 'Save task'}
          initial={editing === 'new' ? { billable: true } : { ...editing }}
          fields={fields}
          onClose={() => setEditing(null)}
          onReload={reload}
          onSubmit={async (values) => {
            setData(editing === 'new' ? await callApi<Tasks>('POST', 'tasks', values) : await callApi<Tasks>('PUT', `tasks/${editing.id}`, { ...values, version: editing.version }))
            setEditing(null)
            toast.success(editing === 'new' ? 'Task created' : 'Task saved')
          }}
        />
      )}
      {dialog}
    </Page>
  )
}
