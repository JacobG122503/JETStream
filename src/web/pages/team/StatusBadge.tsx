import type { PersonStatus } from '../../../shared/api'
import { Badge } from '../../ui'

export function StatusBadge({ status }: { status: PersonStatus }) {
  if (status === 'active') return <Badge tone="success">Active</Badge>
  if (status === 'pending') return <Badge tone="warning">Waiting for approval</Badge>
  return <Badge>Archived</Badge>
}
