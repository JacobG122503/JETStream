import { useState } from 'react'
import type { TeamExpense } from '../../../shared/work'
import { apiUrl } from '../../basePath'
import { useWeekStart } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { addMonths, Badge, Button, Checkbox, DatePicker, formatDate, Select, Table, todayOnDevice } from '../../ui'
import { formatAmounts, formatMoney, moneyInput } from '../../work/format'
import { downloadCsv } from '../../work/csv'
import { useActions } from '../../work/useActions'

const payback: Record<string, string> = { none: 'Not asked', pending: 'After approval', approved: 'To pay back', paid: 'Paid back' }

/** Everyone's expenses that one may see, and paying them back. */
export function TeamExpenses() {
  const weekStart = useWeekStart()
  const today = todayOnDevice()
  const [from, setFrom] = useState(`${addMonths(today, -2).slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [wanted, setWanted] = useState('all')
  const [chosen, setChosen] = useState<number[]>([])
  const { status, data, error, reload, refresh } = useLoad<{ expenses: TeamExpense[]; canReimburse: boolean }>(`expenses/team?from=${from}&to=${to}`)
  const { ask, dialog } = useActions()
  const rows = (data?.expenses ?? []).filter(({ reimbursementStatus }) => wanted === 'all' || reimbursementStatus === wanted)
  const open = rows.filter(({ reimbursementStatus }) => reimbursementStatus === 'approved')
  const marked = open.filter(({ id }) => chosen.includes(id))
  const sums = [...new Set(marked.map(({ currency }) => currency))].map((currency) => ({ currency, amount: marked.filter((row) => row.currency === currency).reduce((sum, { amount }) => sum + amount, 0) }))
  const done = () => {
    setChosen([])
    refresh()
  }
  return (
    <div className="stack">
      <div className="filters">
        <DatePicker weekStart={weekStart} label="From" value={from} onChange={(next) => next && setFrom(next)} />
        <DatePicker weekStart={weekStart} label="To" value={to} onChange={(next) => next && setTo(next)} />
        <Select
          label="Paying back"
          value={wanted}
          options={[{ value: 'all', label: 'All expenses' }, ...Object.entries(payback).map(([value, label]) => ({ value, label }))]}
          onChange={setWanted}
        />
        <Button
          onClick={() =>
            downloadCsv(`expenses ${from} to ${to}`, [
              ['Date', 'Person', 'Client', 'Project', 'Category', 'Notes', 'Billable', 'Amount', 'Currency', 'Status', 'Paying back'],
              ...rows.map((row) => [row.spentOn, row.person.name, row.client, row.project, row.category, row.notes, row.billable ? 'Yes' : 'No', moneyInput(row.amount, row.currency), row.currency, row.status, payback[row.reimbursementStatus] ?? '']),
            ])
          }
        >
          Export
        </Button>
      </div>
      {data?.canReimburse && open.length > 0 && (
        <div className="filters">
          <Button
            variant="primary"
            aria-disabled={marked.length === 0 || undefined}
            onClick={() =>
              marked.length > 0 &&
              ask({
                title: `Record that ${marked.length === 1 ? 'this expense was' : `these ${marked.length} expenses were`} paid back?`,
                message: `${formatAmounts(sums)}. Nothing is paid from here: pay it first, then record it.`,
                confirmLabel: 'Record as paid back', route: 'expenses/reimburse', body: { ids: marked.map(({ id }) => id), paidOn: today }, done: 'Recorded', then: done,
              })
            }
          >
            Record as paid back
          </Button>
          <Button onClick={() => setChosen(marked.length === open.length ? [] : open.map(({ id }) => id))}>{marked.length === open.length ? 'Choose none' : 'Choose all'}</Button>
          <span className="muted">{marked.length === 0 ? `${open.length} to pay back` : `${marked.length} chosen, ${formatAmounts(sums)}`}</span>
        </div>
      )}
      <Table
        caption="Everyone's expenses"
        hideCaption
        status={status}
        error={error}
        onRetry={reload}
        rows={rows}
        rowKey={({ id }) => String(id)}
        rowLabel={({ person, category, spentOn }) => `${person.name}, ${category}, ${formatDate(spentOn)}`}
        columns={[
          ...(data?.canReimburse
            ? [
                {
                  id: 'choose',
                  header: 'Pay back',
                  cell: ({ id, reimbursementStatus, person, category }: TeamExpense) =>
                    reimbursementStatus === 'approved' && (
                      <Checkbox label={`Choose ${category} of ${person.name}`} hideLabel checked={chosen.includes(id)} onChange={(on) => setChosen((before) => (on ? [...before, id] : before.filter((one) => one !== id)))} />
                    ),
                },
              ]
            : []),
          { id: 'date', header: 'Date', nowrap: true, cell: ({ spentOn }) => formatDate(spentOn), sortValue: ({ spentOn }) => spentOn },
          { id: 'person', header: 'Person', cell: ({ person }) => person.name, sortValue: ({ person }) => person.name },
          {
            id: 'what',
            header: 'Expense',
            cell: ({ id, category, notes, receipts }) => (
              <span className="cell-two">
                <span className="strong">{category}</span>
                {notes && <span className="cell-sub">{notes}</span>}
                {receipts.map((receipt, index) => (
                  <a key={receipt.id} href={apiUrl(`expenses/${id}/receipts/${receipt.id}`)} target="_blank" rel="noreferrer">
                    Receipt{receipts.length > 1 ? ` ${index + 1}` : ''}
                  </a>
                ))}
              </span>
            ),
            sortValue: ({ category }) => category,
          },
          { id: 'project', header: 'Project', cell: ({ project, client }) => <span className="cell-two"><span>{project}</span><span className="cell-sub">{client}</span></span>, sortValue: ({ project }) => project },
          { id: 'back', header: 'Paying back', cell: ({ reimbursementStatus }) => <Badge tone={reimbursementStatus === 'paid' ? 'success' : reimbursementStatus === 'approved' ? 'warning' : 'neutral'}>{payback[reimbursementStatus] ?? ''}</Badge> },
          { id: 'amount', header: 'Amount', numeric: true, cell: ({ amount, currency }) => formatMoney(amount, currency), sortValue: ({ amount }) => amount },
        ]}
        rowActions={
          data?.canReimburse
            ? ({ id, reimbursementStatus, person, category }) =>
                reimbursementStatus === 'paid' ? (
                  <Button
                    size="small"
                    aria-label={`Undo paying back ${category} of ${person.name}`}
                    onClick={() => ask({ title: 'Take this back?', message: 'The expense is shown as still to be paid back.', confirmLabel: 'Take back', route: 'expenses/reimburse', body: { ids: [id], paidOn: null }, done: 'Taken back', then: done })}
                  >
                    Undo
                  </Button>
                ) : null
            : undefined
        }
        empty={{ icon: 'expenses', title: 'No expenses', description: 'Nobody entered expenses in this time.' }}
      />
      {dialog}
    </div>
  )
}
