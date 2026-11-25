import type { InvoiceRow } from '../../../shared/work'
import { Badge } from '../../ui'

export function InvoiceStatusBadge({ invoice: { status, late } }: { invoice: Pick<InvoiceRow, 'status' | 'late'> }) {
  if (late) return <Badge tone="danger">Late</Badge>
  if (status === 'paid') return <Badge tone="success">Paid</Badge>
  if (status === 'open') return <Badge tone="info">Open</Badge>
  return <Badge>{status === 'draft' ? 'Draft' : 'Closed'}</Badge>
}
