import { Link, useNavigate } from 'react-router-dom'
import type { RecurringRow } from '../../../shared/billing'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Badge, formatDate, LinkButton, Menu, Table } from '../../ui'
import { formatMoney } from '../../work/format'
import { useActions } from '../../work/useActions'
import { BillingNav } from './BillingNav'
import '../../work/work.css'

const unit = { weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' } as const
const repeats = ({ frequency, interval }: RecurringRow) => (interval === 1 ? `Every ${unit[frequency]}` : `Every ${interval} ${unit[frequency]}s`)

export function RecurringPage() {
  const { status, data, error, reload, refresh } = useLoad<{ recurring: RecurringRow[] }>('recurring')
  const { ask, run, dialog } = useActions()
  const navigate = useNavigate()
  const set = (row: RecurringRow, next: string, done: string) => void run('POST', `recurring/${row.id}/status`, { status: next }, done, refresh)
  return (
    <Page
      title="Recurring invoices"
      description="Made by the server on the day they are due."
      actions={
        <LinkButton to="/invoices/recurring/new" variant="primary" icon="plus">
          New recurring invoice
        </LinkButton>
      }
    >
      <BillingNav current="/invoices/recurring" />
      <Table
        caption="Recurring invoices"
        hideCaption
        status={status}
        error={error}
        onRetry={reload}
        rows={data?.recurring ?? []}
        rowKey={({ id }) => String(id)}
        rowLabel={({ client, subject }) => `${client.name}, ${subject}`}
        columns={[
          {
            id: 'client', header: 'Client', sortValue: ({ client }) => client.name,
            cell: ({ id, client, subject }) => (
              <span className="cell-two">
                <Link to={`/invoices/recurring/${id}`}>{client.name}</Link>
                <span className="cell-sub">{subject}</span>
              </span>
            ),
          },
          { id: 'repeats', header: 'Repeats', cell: (row) => <span className="cell-two"><span>{repeats(row)}</span><span className="cell-sub">{row.sendAutomatically ? 'Sent by itself' : 'Left as a draft'}</span></span> },
          { id: 'next', header: 'Next', nowrap: true, cell: ({ nextOn, status: is }) => (nextOn === null || is !== 'active' ? <span className="muted">-</span> : formatDate(nextOn)), sortValue: ({ nextOn }) => nextOn ?? '' },
          { id: 'status', header: 'Status', cell: ({ status: is }) => <Badge tone={is === 'active' ? 'success' : 'neutral'}>{is === 'active' ? 'Active' : is === 'paused' ? 'Paused' : 'Ended'}</Badge> },
          { id: 'made', header: 'Made', numeric: true, cell: ({ made }) => String(made), sortValue: ({ made }) => made },
          { id: 'total', header: 'Total', numeric: true, cell: ({ total, currency }) => formatMoney(total, currency), sortValue: ({ total }) => total },
        ]}
        rowActions={(row) => (
          <Menu
            label={`Actions for ${row.client.name}, ${row.subject}`}
            iconOnly
            icon="more"
            size="small"
            align="end"
            items={[
              { id: 'edit', label: 'Edit', onSelect: () => navigate(`/invoices/recurring/${row.id}`) },
              ...(row.status === 'active' ? [{ id: 'pause', label: 'Pause', onSelect: () => set(row, 'paused', 'Paused') }] : []),
              ...(row.status === 'paused' ? [{ id: 'go', label: 'Resume', onSelect: () => set(row, 'active', 'Resumed') }] : []),
              ...(row.status !== 'ended'
                ? [{ id: 'end', label: 'End', onSelect: () => ask({ title: 'End this recurring invoice?', message: 'No more invoices are made. Those that were made stay.', confirmLabel: 'End', route: `recurring/${row.id}/status`, body: { status: 'ended' }, done: 'Ended', then: refresh }) }]
                : []),
              ...(row.made === 0
                ? [{ id: 'delete', label: 'Delete', destructive: true, onSelect: () => ask({ title: 'Delete this recurring invoice?', message: 'No invoice was made from it.', confirmLabel: 'Delete', destructive: true, method: 'DELETE', route: `recurring/${row.id}`, done: 'Deleted', then: refresh }) }]
                : []),
            ]}
          />
        )}
        empty={{ icon: 'invoices', title: 'No recurring invoices', description: 'For fees that are billed again and again.' }}
      />
      {dialog}
    </Page>
  )
}
