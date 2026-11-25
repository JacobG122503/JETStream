import { useSearchParams } from 'react-router-dom'
import type { InvoiceList, InvoiceRow } from '../../../shared/work'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { LinkButton, StatTile, Table, Tabs } from '../../ui'
import { formatAmounts } from '../../work/format'
import { invoiceColumns } from './invoiceColumns'
import '../../work/work.css'

const views: { id: string; label: string; shows: (invoice: InvoiceRow) => boolean }[] = [
  { id: 'all', label: 'All', shows: () => true },
  { id: 'open', label: 'Open', shows: ({ status }) => status === 'open' },
  { id: 'late', label: 'Late', shows: ({ late }) => late },
  { id: 'draft', label: 'Drafts', shows: ({ status }) => status === 'draft' },
  { id: 'paid', label: 'Paid', shows: ({ status }) => status === 'paid' },
]

function dueByCurrency(invoices: InvoiceRow[]) {
  const sums = new Map<string, number>()
  for (const { currency, dueAmount } of invoices) sums.set(currency, (sums.get(currency) ?? 0) + dueAmount)
  return [...sums].map(([currency, amount]) => ({ currency, amount }))
}

export function InvoicesPage() {
  const [query, setQuery] = useSearchParams()
  const { status, data, error, reload } = useLoad<InvoiceList>('invoices')
  const invoices = data?.invoices ?? []
  const open = invoices.filter((invoice) => invoice.status === 'open')
  const late = open.filter((invoice) => invoice.late)
  return (
    <Page
      title="Invoices"
      description="What clients owe, and what they have paid."
      actions={
        <LinkButton to="/invoices/new" variant="primary" icon="plus">
          New invoice
        </LinkButton>
      }
    >
      {data && (
        <div className="tiles">
          <StatTile label="Outstanding" value={formatAmounts(dueByCurrency(open), { whole: true })} detail={`${open.length} open invoices`} />
          <StatTile label="Past due" value={formatAmounts(dueByCurrency(late), { whole: true })} detail={`${late.length} late invoices`} />
          <StatTile label="Drafts" value={String(invoices.filter((invoice) => invoice.status === 'draft').length)} detail="not sent yet" />
        </div>
      )}
      <Tabs
        label="Invoices"
        value={query.get('show') ?? 'all'}
        onChange={(show) => setQuery(show === 'all' ? {} : { show }, { replace: true })}
        items={views.map(({ id, label, shows }) => ({
          id,
          label: data && id !== 'all' ? `${label} (${invoices.filter(shows).length})` : label,
          content: (
            <Table
              caption="Invoices"
              hideCaption
              columns={invoiceColumns}
              rows={invoices.filter(shows)}
              rowKey={(invoice) => String(invoice.id)}
              rowLabel={({ number }) => number}
              status={status}
              error={error}
              onRetry={reload}
              empty={{ icon: 'invoices', title: 'No invoices', description: 'There are none of this kind.' }}
            />
          ),
        }))}
      />
    </Page>
  )
}
