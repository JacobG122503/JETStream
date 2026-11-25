import { type FormEvent, useEffect, useId, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ExpenseOptions, ExpenseRow } from '../../../shared/work'
import { callApi, errorMessage } from '../../api'
import { apiUrl } from '../../basePath'
import { useCan, useWeekStart } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Badge, Button, Checkbox, Combobox, ConfirmDialog, DatePicker, Dialog, ErrorState, formatDate, Icon, IconButton, LoadingState, Select, StatTile, Table, type TableColumn, Tabs, TextArea, TextField, todayOnDevice, type Tone, useToast } from '../../ui'
import { formatAmounts, formatMoney, moneyInput, parseMoney } from '../../work/format'
import { useActions } from '../../work/useActions'
import { FileButton } from '../../work/FileButton'
import { TeamExpenses } from './TeamExpenses'
import '../../work/work.css'

const statusLook: Record<ExpenseRow['status'], { label: string; tone: Tone }> = {
  unsubmitted: { label: 'Not submitted', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Sent back', tone: 'warning' },
}

const countOf = (count: number) => (count === 1 ? '1 expense' : `${count} expenses`)

function sums(rows: ExpenseRow[]) {
  const found = new Map<string, number>()
  for (const { currency, amount } of rows) found.set(currency, (found.get(currency) ?? 0) + amount)
  return [...found].map(([currency, amount]) => ({ currency, amount }))
}

export function ExpensesPage() {
  const can = useCan()
  if (!can('time.view')) return <MyExpenses />
  return (
    <Page title="Expenses" description="What was spent for projects.">
      <Tabs label="Expenses" items={[{ id: 'mine', label: 'My expenses', content: <MyExpenses inside /> }, { id: 'team', label: 'Everyone', content: <TeamExpenses /> }]} />
    </Page>
  )
}

function MyExpenses({ inside = false }: { inside?: boolean }) {
  const { status, data, error, reload, setData } = useLoad<{ expenses: ExpenseRow[] }>('expenses')
  const [editing, setEditing] = useState<ExpenseRow | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null)
  const toast = useToast()
  // From the button above the navigation.
  const [query, setQuery] = useSearchParams()
  const wantsNew = query.get('new') !== null
  useEffect(() => {
    if (!wantsNew) return
    setEditing('new')
    setQuery({}, { replace: true })
  }, [wantsNew, setQuery])
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
      cell: ({ status: is, locked, reimbursementStatus, receipts }) => (
        <span className="badges">
          {locked === 'invoiced' ? <Badge tone="success">Invoiced</Badge> : <Badge tone={statusLook[is].tone}>{statusLook[is].label}</Badge>}
          {reimbursementStatus === 'paid' && <Badge tone="success">Reimbursed</Badge>}
          {receipts.length > 0 && <Badge>{receipts.length === 1 ? 'Receipt' : `${receipts.length} receipts`}</Badge>}
        </span>
      ),
      sortValue: ({ status: is }) => is,
    },
    { id: 'amount', header: 'Amount', numeric: true, cell: ({ amount, currency }) => formatMoney(amount, currency), sortValue: ({ amount }) => amount },
  ]

  const button = (
    <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
      New expense
    </Button>
  )
  const content = (
    <>
      {inside && <div>{button}</div>}
      {data && (
        <div className="tiles">
          <StatTile label="This month" value={formatAmounts(sums(thisMonth))} detail={countOf(thisMonth.length)} />
          <StatTile label="Waiting to be paid back" value={formatAmounts(sums(waiting))} detail={countOf(waiting.length)} />
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
            <span className="row-icons">
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
          onChanged={setData}
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
    </>
  )
  return inside ? (
    <div className="stack">{content}</div>
  ) : (
    <Page title="Expenses" description="What you spent for projects." actions={button}>
      {content}
    </Page>
  )
}

const fields = ['projectId', 'categoryId', 'spentOn', 'amount', 'notes'] as const

interface ExpenseDialogProps {
  expense: ExpenseRow | null
  onClose: () => void
  onReload: () => void
  /** The list, where it changed before the expense is saved. */
  onChanged: (next: { expenses: ExpenseRow[] }) => void
  onSaved: (next: { expenses: ExpenseRow[] }) => void
}

const receiptTypes = 'image/png,image/jpeg,application/pdf'
const receiptBytes = 5 * 1024 * 1024

function ExpenseDialog({ expense, onClose, onReload, onChanged, onSaved }: ExpenseDialogProps) {
  const weekStart = useWeekStart()
  const formId = useId()
  const toast = useToast()
  const { run } = useActions()
  const { status, data, error, reload } = useLoad<ExpenseOptions>('expenses/options')
  const form = useForm('expense', fields)
  const [projectId, setProjectId] = useState<string | null>(expense ? String(expense.projectId) : null)
  const [categoryId, setCategoryId] = useState(expense ? String(expense.categoryId) : '')
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? todayOnDevice())
  const [amount, setAmount] = useState(() => {
    if (!expense) return ''
    return expense.quantity !== null ? String(expense.quantity / 1000) : moneyInput(expense.amount, expense.currency)
  })
  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [billable, setBillable] = useState(expense?.billable ?? true)
  const [reimbursable, setReimbursable] = useState(expense?.reimbursable ?? true)
  const [added, setAdded] = useState<File[]>([])
  const [receipts, setReceipts] = useState(expense?.receipts ?? [])
  const [version, setVersion] = useState(expense?.version ?? 0)
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
        const saved = expense
          ? { id: expense.id, ...(await callApi<{ expenses: ExpenseRow[] }>('PUT', `expenses/${expense.id}`, { ...body, version })) }
          : await callApi<{ id: number; expenses: ExpenseRow[] }>('POST', 'expenses', body)
        let next: { expenses: ExpenseRow[] } = saved
        try {
          for (const file of added) {
            const now = next.expenses.find(({ id }) => id === saved.id)?.version ?? 0
            next = await callApi<{ expenses: ExpenseRow[] }>('PUT', `expenses/${saved.id}/receipts/${now}`, file)
          }
        } catch (reason) {
          // The expense itself is saved.
          toast.error(`The receipt was not added. ${errorMessage(reason)}`)
        }
        onSaved(next)
      },
      {
        projectId: projectId === null ? 'Choose a project.' : null,
        categoryId: categoryId === '' ? 'Choose a category.' : null,
        spentOn: spentOn === '' ? 'Enter a date.' : null,
        notes: data?.notesRequired && notes.trim() === '' ? 'Enter notes.' : null,
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
            <DatePicker weekStart={weekStart} label="Date" required value={spentOn} onChange={setSpentOn} {...form.field('spentOn')} />
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
          <TextArea label="Notes" rows={2} required={data.notesRequired} value={notes} onChange={setNotes} {...form.field('notes')} />
          <div className="receipts">
            <FileButton
              accept={receiptTypes}
              icon="plus"
              label="Attach receipt"
              onChoose={(file) => {
                if (file.size > receiptBytes) toast.error('A receipt can have 5 MB at most.')
                else setAdded((before) => [...before, file])
              }}
            />
            {receipts.map(({ id, name }) => (
              <span key={id} className="badges">
                <a href={apiUrl(`expenses/${expense?.id}/receipts/${id}`)} target="_blank" rel="noreferrer">
                  {name}
                </a>
                <IconButton
                  icon="close"
                  size="small"
                  variant="quiet"
                  label={`Remove ${name}`}
                  onClick={() =>
                    void run('POST', `expenses/${expense?.id}/receipts/${id}/delete`, { version }, 'Receipt removed', (next: { expenses: ExpenseRow[] }) => {
                      const now = next.expenses.find((row) => row.id === expense?.id)
                      setReceipts(now?.receipts ?? [])
                      setVersion(now?.version ?? version)
                      onChanged(next)
                    })
                  }
                />
              </span>
            ))}
            {added.map((file, index) => (
              <span key={`${index} ${file.name}`} className="badges">
                <span>{file.name}</span>
                <IconButton icon="close" size="small" variant="quiet" label={`Remove ${file.name}`} onClick={() => setAdded((before) => before.filter((one) => one !== file))} />
              </span>
            ))}
          </div>
          <Checkbox label="Bill it to the client" disabled={project?.billable === false} checked={billable && project?.billable !== false} onChange={setBillable} />
          <Checkbox label="I paid it myself and want it back" checked={reimbursable} onChange={setReimbursable} />
        </form>
      )}
    </Dialog>
  )
}
