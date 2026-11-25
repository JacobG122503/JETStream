import { Link } from 'react-router-dom'
import type { InvoiceRow } from '../../../shared/work'
import { formatDate, type TableColumn } from '../../ui'
import { formatMoney } from '../../work/format'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'

export const invoiceColumns: TableColumn<InvoiceRow>[] = [
  {
    id: 'number',
    header: 'Invoice',
    cell: ({ id, number, subject }) => (
      <span className="cell-two">
        <Link to={`/invoices/${id}`}>{number}</Link>
        <span className="cell-sub">{subject}</span>
      </span>
    ),
    sortValue: ({ number }) => number,
  },
  { id: 'client', header: 'Client', cell: ({ client }) => client.name, sortValue: ({ client }) => client.name },
  { id: 'status', header: 'Status', cell: (invoice) => <InvoiceStatusBadge invoice={invoice} />, sortValue: ({ status, late }) => (late ? 'late' : status) },
  { id: 'issued', header: 'Issued', nowrap: true, cell: ({ issuedOn }) => formatDate(issuedOn), sortValue: ({ issuedOn }) => issuedOn },
  { id: 'due', header: 'Due', nowrap: true, cell: ({ dueOn }) => formatDate(dueOn), sortValue: ({ dueOn }) => dueOn },
  { id: 'total', header: 'Total', numeric: true, cell: ({ total, currency }) => formatMoney(total, currency), sortValue: ({ total }) => total },
  {
    id: 'balance',
    header: 'Still due',
    numeric: true,
    cell: ({ dueAmount, currency, status }) => (status === 'closed' || dueAmount === 0 ? <span className="muted">-</span> : formatMoney(dueAmount, currency)),
    sortValue: ({ dueAmount }) => dueAmount,
  },
]
