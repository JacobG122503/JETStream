import { type FormEvent, useId, useState } from 'react'
import type { ExpenseOptions, ExpenseRow } from '../../../shared/work'
import { callApi, errorMessage } from '../../api'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Badge, Button, Checkbox, Combobox, ConfirmDialog, DatePicker, Dialog, ErrorState, formatDate, Icon, IconButton, LoadingState, Select, StatTile, Table, type TableColumn, TextArea, TextField, todayOnDevice, type Tone, useToast } from '../../ui'
import { formatAmounts, formatMoney, parseMoney } from '../../work/format'
import '../../work/work.css'

const statusLook: Record<ExpenseRow['status'], { label: string; tone: Tone }> = {
  unsubmitted: { label: 'Not handed in', tone: 'neutral' },
  submitted: { label: 'Handed in', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Sent back', tone: 'warning' },
}

function sums(rows: ExpenseRow[]) {
  const found = new Map<string, number>()
  for (const { currency, amount } of rows) found.set(currency, (found.get(currency) ?? 0) + amount)
  return [...found].map(([currency, amount]) => ({ currency, amount }))
}

export function ExpensesPage() {
  const { status, data, error, reload, setData } = useLoad<{ expenses: ExpenseRow[] }>('expenses')
  const [editing, setEditing] = useState<ExpenseRow | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null)
  const toast = useToast()
  const rows = data?.expenses ?? []
  const month = todayOnDevice().slice(0, 7)
  const thisMonth = rows.filter(({ spentOn }) => spentOn.startsWith(month))
  const waiting = rows.filter(({ reimbursementStatus }) => reimbursementStatus === 'pending' || reimbursementStatus === 'approved')

  const columns: TableColumn<ExpenseRow>[] = [
    { id: 'date', header: 'Date', nowrap: true, cell: ({ spentOn }) => formatDate(spentOn), sortValue: ({ spentOn }) => spentOn },
    {
      id: 'what',
      header: 'Expense',
      cell: ({ category, notes }) => (
        <span className="cell-two">
          <span className="strong">{category}</span>
          {notes && <span className="cell-sub">{notes}</span>}
        </span>
      ),
      sortValue: ({ category }) => category,
    },
    {
      id: 'project',
      header: 'Project',
      cell: ({ project, client }) => (
        <span className="cell-two">
          <span>{project}</span>
          <span className="cell-sub">{client}</span>
        </span>
      ),
      sortValue: ({ project }) => project,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ status: is, locked, reimbursementStatus }) => (
        <span className="badges">
          {locked === 'invoiced' ? <Badge tone="success">Invoiced</Badge> : <Badge tone={statusLook[is].tone}>{statusLook[is].label}</Badge>}
          {reimbursementStatus === 'paid' && <Badge tone="success">Reimbursed</Badge>}
        </span>
      ),
      sortValue: ({ status: is }) => is,
    },
    { id: 'amount', header: 'Amount', numeric: true, cell: ({ amount, currency }) => formatMoney(amount, currency), sortValue: ({ amount }) => amount },
  ]

  return (
    <Page
      title="Expenses"
      description="What you spent for projects."
      actions={
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          New expense
        </Button>
      }
    >
      {data && (
        <div className="tiles">
          <StatTile label="This month" value={formatAmounts(sums(thisMonth))} detail={`${thisMonth.length} expenses`} />
          <StatTile label="Waiting to be paid back" value={formatAmounts(sums(waiting))} detail={`${waiting.length} expenses`} />
        </div>
      )}
      <Table
        caption="Expenses"
        hideCaption
        columns={columns}
        rows={rows}
        rowKey={({ id }) => String(id)}
        rowLabel={({ category, spentOn }) => `${category}, ${formatDate(spentOn)}`}
        status={status}
        error={error}
        onRetry={reload}
        empty={{ icon: 'expenses', title: 'No expenses', description: 'Add what you spent for a project.' }}
        rowActions={(row) =>
          row.locked ? (
            <span className="entry-lock" aria-hidden="true">
              <Icon name="lock" />
            </span>
          ) : (
            <span className="row-actions">
              <IconButton icon="edit" size="small" variant="quiet" label={`Edit ${row.category}, ${formatDate(row.spentOn)}`} onClick={() => setEditing(row)} />
              <IconButton icon="trash" size="small" variant="quiet" label={`Delete ${row.category}, ${formatDate(row.spentOn)}`} onClick={() => setDeleting(row)} />
            </span>
          )
        }
      />
      {editing && (
        <ExpenseDialog
          expense={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onReload={reload}
          onSaved={(next) => {
            setData(next)
            toast.success(editing === 'new' ? 'Expense added' : 'Expense saved')
            setEditing(null)
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this expense?"
        message={deleting && `${deleting.category}, ${formatMoney(deleting.amount, deleting.currency)}, ${formatDate(deleting.spentOn)}.`}
        confirmLabel="Delete expense"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          try {
            setData(await callApi<{ expenses: ExpenseRow[] }>('POST', `expenses/${deleting.id}/delete`, { version: deleting.version }))
            toast.success('Expense deleted')
          } catch (reason) {
            throw new Error(errorMessage(reason), { cause: reason })
          }
        }}
      />
    </Page>
  )
}

const fields = ['projectId', 'categoryId', 'spentOn', 'amount', 'notes'] as const

interface ExpenseDialogProps {
  expense: ExpenseRow | null
  onClose: () => void
  onReload: () => void
  onSaved: (next: { expenses: ExpenseRow[] }) => void
}

function ExpenseDialog({ expense, onClose, onReload, onSaved }: ExpenseDialogProps) {
  const formId = useId()
  const { status, data, error, reload } = useLoad<ExpenseOptions>('expenses/options')
  const form = useForm('expense', fields)
  const [projectId, setProjectId] = useState<string | null>(expense ? String(expense.projectId) : null)
  const [categoryId, setCategoryId] = useState(expense ? String(expense.categoryId) : '')
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? todayOnDevice())
  const [amount, setAmount] = useState(() => {
    if (!expense) return ''
    return expense.quantity !== null ? String(expense.quantity / 1000) : formatMoney(expense.amount, expense.currency).replace(/[^\d.]/g, '')
  })
  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [billable, setBillable] = useState(expense?.billable ?? true)
  const [reimbursable, setReimbursable] = useState(expense?.reimbursable ?? true)
  const project = data?.projects.find(({ id }) => String(id) === projectId)
  const category = data?.categories.find(({ id }) => String(id) === categoryId)
  const unit = category?.unitName ?? null
  const currency = project?.currency ?? 'USD'
  const units = /^\d{1,6}(\.\d{1,3})?$/.test(amount.trim()) ? Math.round(Number(amount) * 1000) : null
  const money = parseMoney(amount, currency)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        const body = {
          projectId: Number(projectId), categoryId: Number(categoryId), spentOn, amount: unit === null ? money : 0, quantity: unit === null ? null : units, notes,
          billable, reimbursable,
        }
        onSaved(
          expense
            ? await callApi<{ expenses: ExpenseRow[] }>('PUT', `expenses/${expense.id}`, { ...body, version: expense.version })
            : await callApi<{ expenses: ExpenseRow[] }>('POST', 'expenses', body),
        )
      },
      {
        projectId: projectId === null ? 'Choose a project.' : null,
        categoryId: categoryId === '' ? 'Choose a category.' : null,
        spentOn: spentOn === '' ? 'Enter a date.' : null,
        amount: (unit === null ? money : units) ? null : unit === null ? 'Enter an amount such as 18.50.' : `Enter how many, such as 24.`,
      },
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={expense ? 'Edit expense' : 'New expense'}
      closeOnOutsidePress={false}
      busy={form.busy}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={form.busy} loadingLabel="Saving" aria-disabled={!data || undefined}>
            {expense ? 'Save expense' : 'Add expense'}
          </Button>
        </>
      }
    >
      {status === 'loading' && <LoadingState label="Loading projects" />}
      {status === 'error' && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <form id={formId} className="stack" noValidate onSubmit={submit}>
          <FormMessages form={form} onReload={onReload} />
          <Combobox
            label="Project"
            required
            placeholder="Search projects"
            value={projectId}
            options={data.projects.map(({ id, name, client }) => ({ value: String(id), label: name, group: client }))}
            onChange={setProjectId}
            {...form.field('projectId')}
          />
          <div className="form-pair">
            <Select
              label="Category"
              required
              placeholder="Choose a category"
              value={categoryId}
              options={data.categories.map(({ id, name }) => ({ value: String(id), label: name }))}
              onChange={setCategoryId}
              {...form.field('categoryId')}
            />
            <DatePicker label="Date" required value={spentOn} onChange={setSpentOn} {...form.field('spentOn')} />
          </div>
          <TextField
            label={unit === null ? `Amount (${currency})` : `How many (${unit})`}
            required
            inputMode="decimal"
            hint={unit !== null && category?.unitPrice ? `${formatMoney(Math.round(category.unitPrice / 1000), currency)} for each ${unit}` : undefined}
            value={amount}
            onChange={setAmount}
            {...form.field('amount')}
          />
          <TextArea label="Notes" rows={2} value={notes} onChange={setNotes} {...form.field('notes')} />
          <Checkbox label="Bill it to the client" disabled={project?.billable === false} checked={billable && project?.billable !== false} onChange={setBillable} />
          <Checkbox label="I paid it myself and want it back" checked={reimbursable} onChange={setReimbursable} />
        </form>
      )}
    </Dialog>
  )
}
