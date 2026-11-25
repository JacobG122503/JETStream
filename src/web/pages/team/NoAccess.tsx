import { EmptyState } from '../../ui'

export function NoAccess() {
  return (
    <EmptyState
      size="page"
      icon="lock"
      headingLevel={2}
      title="You do not have access to this page"
      description="Ask an administrator if you need it."
    />
  )
}
