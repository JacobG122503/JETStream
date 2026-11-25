import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { DocumentOptions, RetainerDetails, RetainerRow } from '../../../shared/billing'
import { callApi } from '../../api'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Badge, Button, Card, ErrorState, formatDate, LinkButton, LoadingState, Menu, Notice, StatTile, Table, todayOnDevice, useToast } from '../../ui'
import { FormDialog } from '../../work/FormDialog'
import { formatMoney } from '../../work/format'
import { useActions } from '../../work/useActions'
import { BillingNav } from './BillingNav'
import '../../work/work.css'

export function RetainersPage() {
  const { status, data, error, reload } = useLoad<{ retainers: RetainerRow[] }>('retainers')
  const options = useLoad<DocumentOptions>('documents/options')
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  return (
    <Page
      title="Retainers"
      description="Money that clients paid in advance."
      actions={
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
          New retainer
        </Button>
      }
    >
      <BillingNav current="/invoices/retainers" />
      <Table
        caption="Retainers"
        hideCaption
        status={status}
        error={error}
        onRetry={reload}
        rows={data?.retainers ?? []}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        columns={[
          { id: 'name', header: 'Retainer', cell: ({ id, name, project }) => <span className="cell-two"><Link to={`/invoices/retainers/${id}`}>{name}</Link><span className="cell-sub">{project?.name}</span></span>, sortValue: ({ name }) => name },
          { id: 'client', header: 'Client', cell: ({ client }) => client.name, sortValue: ({ client }) => client.name },
          { id: 'status', header: 'Status', cell: ({ status: is }) => <Badge tone={is === 'active' ? 'success' : 'neutral'}>{is === 'active' ? 'Active' : 'Closed'}</Badge> },
          { id: 'balance', header: 'Left', numeric: true, cell: ({ balance, currency }) => formatMoney(balance, currency), sortValue: ({ balance }) => balance },
        ]}
        empty={{ icon: 'dollar', title: 'No retainers', description: 'For money a client pays before the work.' }}
      />
      {adding && options.data && (
        <FormDialog
          title="New retainer"
          submitLabel="Create retainer"
          fields={[
            { name: 'clientId', label: 'Client', type: 'id', required: true, placeholder: 'Choose a client', options: options.data.clients.map(({ id, name }) => ({ value: String(id), label: name })) },
            { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Deposit for engineering' },
            { name: 'projectId', label: 'Project', type: 'id', hint: 'Only if it is for one project of the client.', placeholder: 'Any project', options: options.data.clients.flatMap((client) => client.projects.map(({ id, name }) => ({ value: String(id), label: `${name} (${client.name})` }))) },
          ]}
          onClose={() => setAdding(false)}
          onSubmit={async (values) => {
            const { id } = await callApi<{ id: number }>('POST', 'retainers', values)
            navigate(`/invoices/retainers/${id}`)
          }}
        />
      )}
    </Page>
  )
}

const kinds: Record<string, string> = { top_up: 'Paid in', draw_down: 'Used for an invoice', refund: 'Given back', adjustment: 'Adjustment' }

export function RetainerPage() {
  const { id = '' } = useParams()
  const { status, data, error, reload, setData } = useLoad<RetainerDetails>(`retainers/${encodeURIComponent(id)}`)
  const [adding, setAdding] = useState<'top_up' | 'refund' | 'adjustment' | 'use' | null>(null)
  const { run } = useActions()
  const toast = useToast()
  const money = (amount: number) => formatMoney(amount, data?.currency ?? 'USD')
  const saved = (next: RetainerDetails, message: string) => {
    setData(next)
    setAdding(null)
    toast.success(message)
  }
  return (
    <Page
      title={data?.name ?? 'Retainer'}
      description={data && <span className="facts-line"><Link to={`/clients/${data.client.id}`}>{data.client.name}</Link>{data.project && <span>{data.project.name}</span>}{data.status === 'closed' && <Badge>Closed</Badge>}</span>}
      actions={
        <>
          <LinkButton to="/invoices/retainers" icon="chevronLeft">
            Retainers
          </LinkButton>
          {data && (
            <Menu
              label="More"
              align="end"
              items={
                data.status === 'closed'
                  ? [{ id: 'reopen', label: 'Reopen', onSelect: () => void run('POST', `retainers/${id}/status`, { status: 'active' }, 'Reopened', setData) }]
                  : [
                      { id: 'refund', label: 'Give money back', onSelect: () => setAdding('refund') },
                      { id: 'adjust', label: 'Adjust the balance', onSelect: () => setAdding('adjustment') },
                      { id: 'close', label: 'Close', onSelect: () => void run('POST', `retainers/${id}/status`, { status: 'closed' }, 'Closed', setData) },
                    ]
              }
            />
          )}
          {data?.status === 'active' && data.balance > 0 && data.openInvoices.length > 0 && <Button onClick={() => setAdding('use')}>Use for an invoice</Button>}
          {data?.status === 'active' && (
            <Button variant="primary" icon="plus" onClick={() => setAdding('top_up')}>
              Record money paid in
            </Button>
          )}
        </>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the retainer" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error === 'Not found' ? 'There is no such retainer.' : error} onRetry={reload} />}
      {data && (
        <>
          <div className="tiles">
            <StatTile label="Left" value={money(data.balance)} />
          </div>
          <Card title="What came and went">
            {data.entries.length === 0 && <p className="muted">Nothing yet.</p>}
            <ul className="payments">
              {data.entries.map(({ id: entryId, kind, amount, on, notes, invoice }) => (
                <li key={entryId}>
                  <span className="cell-two">
                    <span>
                      <span className="strong">{money(amount)}</span> <span className="muted">{kinds[kind] ?? kind}</span> {invoice && <Link to={`/invoices/${invoice.id}`}>{invoice.number}</Link>}
                    </span>
                    {notes && <span className="cell-sub">{notes}</span>}
                  </span>
                  <span className="muted">{formatDate(on)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      {data && adding === 'use' && (
        <FormDialog
          title="Use for an invoice"
          submitLabel="Pay"
          initial={{ invoiceId: data.openInvoices[0]?.id, amount: Math.min(data.balance, data.openInvoices[0]?.dueAmount ?? 0) }}
          fields={[
            { name: 'invoiceId', label: 'Invoice', type: 'id', required: true, options: data.openInvoices.map(({ id: invoiceId, number, dueAmount }) => ({ value: String(invoiceId), label: `${number}, ${money(dueAmount)} due` })) },
            { name: 'amount', label: 'Amount', type: 'money', currency: data.currency, required: true },
          ]}
          onClose={() => setAdding(null)}
          onSubmit={async (values) => {
            const { invoiceId, amount } = values as unknown as { invoiceId: number; amount: number }
            await callApi('POST', `invoices/${invoiceId}/pay-from-retainer`, { retainerId: data.id, amount })
            saved(await callApi<RetainerDetails>('GET', `retainers/${data.id}`), 'Paid')
          }}
        />
      )}
      {data && adding !== null && adding !== 'use' && (
        <FormDialog
          title={adding === 'top_up' ? 'Record money paid in' : adding === 'refund' ? 'Record money given back' : 'Adjust the balance'}
          submitLabel="Record"
          intro={adding === 'adjustment' ? undefined : <Notice>For money that has already moved. Nothing is charged or paid here.</Notice>}
          initial={{ on: todayOnDevice(), less: false }}
          fields={[
            { name: 'amount', label: 'Amount', type: 'money', currency: data.currency, required: true, half: true },
            { name: 'on', label: 'Date', type: 'date', required: true, half: true },
            { name: 'less', label: 'Take this amount away', type: 'check', show: () => adding === 'adjustment' },
            { name: 'notes', label: 'Notes', type: 'area', rows: 2 },
          ]}
          onClose={() => setAdding(null)}
          onSubmit={async (values) => {
            const { less, amount, ...rest } = values as unknown as { less: boolean; amount: number; on: string; notes: string }
            saved(await callApi<RetainerDetails>('POST', `retainers/${data.id}/entries`, { ...rest, kind: adding, amount: less ? -amount : amount, invoiceId: null }), 'Recorded')
          }}
        />
      )}
    </Page>
  )
}
