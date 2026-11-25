import type { InvoiceDetails } from '../../../shared/billing'
import type { UnbilledClient } from '../../../shared/work'
import { callApi } from '../../api'
import { useLoad } from '../../auth/useLoad'
import { Button, Dialog, EmptyState, ErrorState, LoadingState } from '../../ui'
import { FormDialog } from '../../work/FormDialog'
import { formatMoney } from '../../work/format'

interface AddUnbilledDialogProps {
  invoice: InvoiceDetails
  onClose: () => void
  onAdded: (invoice: InvoiceDetails) => void
}

/** Hours and expenses of the client that are not on an invoice yet. */
export function AddUnbilledDialog({ invoice, onClose, onAdded }: AddUnbilledDialogProps) {
  const { status, data, error, reload } = useLoad<{ clients: UnbilledClient[] }>('invoices/unbilled')
  const projects = data?.clients.find(({ id }) => id === invoice.client.id)?.projects ?? []
  if (!data || projects.length === 0) {
    return (
      <Dialog open onClose={onClose} title="Add time and expenses" footer={<Button onClick={onClose}>Close</Button>}>
        {status === 'loading' && <LoadingState label="Loading what can be invoiced" />}
        {status === 'error' && <ErrorState message={error} onRetry={reload} />}
        {data && <EmptyState icon="success" headingLevel={3} title="Everything is invoiced" description="There are no hours or expenses of this client to bill." />}
      </Dialog>
    )
  }
  return (
    <FormDialog
      title="Add time and expenses"
      submitLabel="Add"
      initial={{ projectIds: projects.map(({ id }) => id), grouping: 'task', withExpenses: true }}
      fields={[
        {
          name: 'projectIds', label: 'Projects', type: 'ids', required: true,
          options: projects.map(({ id, name, timeAmount, expenseAmount }) => ({ value: String(id), label: `${name}, ${formatMoney(timeAmount + expenseAmount, invoice.currency)}` })),
        },
        { name: 'from', label: 'From', type: 'date', half: true },
        { name: 'to', label: 'To', type: 'date', half: true },
        { name: 'grouping', label: 'One line for each', type: 'select', options: [{ value: 'task', label: 'Task' }, { value: 'person', label: 'Person' }, { value: 'project', label: 'Project' }, { value: 'detailed', label: 'Entry' }] },
        { name: 'withExpenses', label: 'Include billable expenses', type: 'check' },
      ]}
      onClose={onClose}
      onSubmit={async (values) => onAdded(await callApi<InvoiceDetails>('POST', `invoices/${invoice.id}/add`, { ...values, version: invoice.version }))}
    />
  )
}
