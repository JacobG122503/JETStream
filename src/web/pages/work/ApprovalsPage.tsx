import { Fragment, useState } from 'react'
import type { Approvals, ApprovalWeek } from '../../../shared/work'
import { callApi } from '../../api'
import { useLoad } from '../../auth/useLoad'
import { photoUrl } from '../../shell/photo'
import { Page } from '../../shell/Page'
import { Avatar, Badge, Button, EmptyState, ErrorState, formatDate, LoadingState, Meter, Notice, Table, Tabs, useToast } from '../../ui'
import { FormDialog } from '../../work/FormDialog'
import { formatAmounts, formatDay, formatHours, formatMoney, formatWeek, percentOf } from '../../work/format'
import { useActions } from '../../work/useActions'
import '../../work/work.css'

export function ApprovalsPage() {
  const { status, data, error, reload, refresh, setData } = useLoad<Approvals>('approvals')
  const counted = (label: string, count: number) => (count > 0 ? `${label} (${count})` : label)
  return (
    <Page title="Approvals">
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading approvals" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && (
        <Tabs
          label="Approvals"
          items={[
            { id: 'pending', label: counted('Waiting', data.pending.length), content: <Pending data={data} onChange={setData} /> },
            { id: 'missing', label: counted('Not submitted', data.missing.length), content: <Missing data={data} onChange={refresh} /> },
            { id: 'approved', label: 'Approved', content: <Approved data={data} onChange={refresh} /> },
          ]}
        />
      )}
    </Page>
  )
}

function Pending({ data, onChange }: { data: Approvals; onChange: (data: Approvals) => void }) {
  const [open, setOpen] = useState<number | null>(null)
  const [rejecting, setRejecting] = useState<ApprovalWeek | null>(null)
  const { run, dialog } = useActions()
  const toast = useToast()
  if (data.pending.length === 0) return <EmptyState icon="success" headingLevel={2} title="Nothing to approve" description="Weeks that people submit appear here." />
  return (
    <div className="stack">
      <ul className="approvals">
        {data.pending.map((week) => {
          const shown = open === week.submissionId
          const part = [...week.entries, ...week.expenseRows].some(({ mine }) => !mine)
          return (
            <li key={week.submissionId} className="approval">
              <div className="approval-head">
                <Avatar name={week.person.name} src={photoUrl(week.person.photoId)} decorative />
                <div className="approval-who">
                  <span className="strong">{week.person.name}</span>
                  <span className="muted">{formatWeek(week.from, week.to)}</span>
                </div>
                <div className="approval-hours">
                  <span>
                    <strong className="figure">{formatHours(week.minutes)}</strong> <span className="muted">of {formatHours(week.capacityMinutes)}</span>
                  </span>
                  <Meter percent={percentOf(week.minutes, week.capacityMinutes)} />
                </div>
                <span className="muted figure approval-share">
                  {percentOf(week.billableMinutes, week.minutes)}% billable{week.expenses.length > 0 ? `, expenses ${formatAmounts(week.expenses)}` : ''}
                </span>
                <div className="approval-actions">
                  <Button size="small" variant="quiet" aria-expanded={shown} onClick={() => setOpen(shown ? null : week.submissionId)}>
                    {shown ? 'Hide' : 'Show'} details<span className="sr-only"> of {week.person.name}</span>
                  </Button>
                  <Button size="small" onClick={() => setRejecting(week)} aria-label={`Send back the week of ${week.person.name}`}>
                    Send back
                  </Button>
                  <Button
                    size="small"
                    variant="primary"
                    icon="check"
                    aria-label={`Approve the week of ${week.person.name}`}
                    onClick={() => void run('POST', `approvals/${week.submissionId}/approve`, undefined, `Approved ${week.person.name}`, onChange)}
                  >
                    Approve
                  </Button>
                </div>
              </div>
              {part && <Notice>You approve the part of the week that is on your projects. The rest waits for others.</Notice>}
              {shown && <Details week={week} />}
            </li>
          )
        })}
      </ul>
      {rejecting && (
        <FormDialog
          title={`Send back the week of ${rejecting.person.name}?`}
          submitLabel="Send back"
          intro={<p className="muted">They can change it and submit it again.</p>}
          fields={[{ name: 'comment', label: 'What should be changed?', type: 'area' }]}
          onClose={() => setRejecting(null)}
          onSubmit={async (values) => {
            onChange(await callApi<Approvals>('POST', `approvals/${rejecting.submissionId}/reject`, values))
            setRejecting(null)
            toast.success('Sent back')
          }}
        />
      )}
      {dialog}
    </div>
  )
}

function Details({ week }: { week: ApprovalWeek }) {
  const days = [...new Set(week.entries.map(({ spentOn }) => spentOn))]
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`Time of ${week.person.name}`}>
      <table className="paper-lines approval-lines">
        <thead>
          <tr>
            <th scope="col">Project and task</th>
            <th scope="col">Hours</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <Fragment key={day}>
              <tr>
                <th scope="rowgroup" colSpan={2}>
                  {formatDay(day)}
                </th>
              </tr>
              {week.entries
                .filter(({ spentOn }) => spentOn === day)
                .map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <span className="strong">{entry.project}</span> <span className="muted">({entry.client})</span>, {entry.task}
                      {!entry.billable && <span className="muted"> (non-billable)</span>}
                      {entry.notes && <span className="line muted">{entry.notes}</span>}
                    </td>
                    <td>{formatHours(entry.minutes)}</td>
                  </tr>
                ))}
            </Fragment>
          ))}
          {week.expenseRows.length > 0 && (
            <tr>
              <th scope="rowgroup" colSpan={2}>
                Expenses
              </th>
            </tr>
          )}
          {week.expenseRows.map((expense) => (
            <tr key={expense.id}>
              <td>
                {formatDate(expense.spentOn)}, {expense.category}, <span className="strong">{expense.project}</span>
                {expense.notes && <span className="line muted">{expense.notes}</span>}
              </td>
              <td>{formatMoney(expense.amount, expense.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Missing({ data, onChange }: { data: Approvals; onChange: () => void }) {
  const { run, ask, dialog } = useActions()
  return (
    <>
      <Table
        caption="Weeks that were not submitted"
        hideCaption
        rows={data.missing}
        rowKey={({ person, from }) => `${person.id}/${from}`}
        rowLabel={({ person, from }) => `${person.name}, ${from}`}
        columns={[
          { id: 'person', header: 'Person', cell: ({ person }) => <span className="strong">{person.name}</span>, sortValue: ({ person }) => person.name },
          { id: 'week', header: 'Week', nowrap: true, cell: ({ from, to }) => formatWeek(from, to), sortValue: ({ from }) => from },
          { id: 'hours', header: 'Hours', numeric: true, cell: ({ minutes, capacityMinutes }) => `${formatHours(minutes)} of ${formatHours(capacityMinutes)}`, sortValue: ({ minutes }) => minutes },
        ]}
        rowActions={({ person, from }) => (
          <span className="row-actions">
            <Button size="small" aria-label={`Remind ${person.name}, ${from}`} onClick={() => void run('POST', 'approvals/remind', { personIds: [person.id], date: from }, `Reminded ${person.name}`, onChange)}>
              Remind
            </Button>
            {data.canUnlock && (
              <Button
                size="small"
                aria-label={`Unlock ${person.name}, ${from}`}
                onClick={() =>
                  ask({
                    title: `Unlock this week for ${person.name}?`, message: 'They can change it for seven days, even if it is locked by date.', confirmLabel: 'Unlock', route: 'approvals/unlock',
                    body: { personId: person.id, date: from }, done: 'Unlocked', then: onChange,
                  })
                }
              >
                Unlock
              </Button>
            )}
          </span>
        )}
        empty={{ icon: 'success', title: 'Everyone submitted', description: 'All weeks of the last month were submitted.' }}
      />
      {dialog}
    </>
  )
}

function Approved({ data, onChange }: { data: Approvals; onChange: () => void }) {
  const { ask, dialog } = useActions()
  return (
    <>
      <Table
        caption="Approved weeks"
        hideCaption
        rows={data.approved}
        rowKey={({ submissionId }) => String(submissionId)}
        rowLabel={({ person, from }) => `${person.name}, ${from}`}
        columns={[
          { id: 'person', header: 'Person', cell: ({ person }) => <span className="strong">{person.name}</span>, sortValue: ({ person }) => person.name },
          { id: 'week', header: 'Week', nowrap: true, cell: ({ from, to }) => formatWeek(from, to), sortValue: ({ from }) => from },
          { id: 'hours', header: 'Hours', numeric: true, cell: ({ minutes }) => formatHours(minutes), sortValue: ({ minutes }) => minutes },
          { id: 'by', header: 'Approved by', cell: ({ decidedBy }) => decidedBy ?? <Badge>System</Badge>, sortValue: ({ decidedBy }) => decidedBy ?? '' },
        ]}
        rowActions={
          data.canUnlock
            ? ({ submissionId, person }) => (
                <Button
                  size="small"
                  aria-label={`Open the week of ${person.name} again`}
                  onClick={() =>
                    ask({
                      title: `Open this week of ${person.name} again?`, message: 'What is not invoiced can be changed, and the week has to be submitted again.', confirmLabel: 'Open again',
                      route: `approvals/${submissionId}/reopen`, done: 'Opened again', then: onChange,
                    })
                  }
                >
                  Open again
                </Button>
              )
            : undefined
        }
        empty={{ icon: 'inbox', title: 'Nothing yet', description: 'No week was approved yet.' }}
      />
      {dialog}
    </>
  )
}
