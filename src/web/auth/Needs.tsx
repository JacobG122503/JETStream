import type { ReactNode } from 'react'
import type { PermissionKey } from '../../shared/permissions'
import { Page } from '../shell/Page'
import { EmptyState, LinkButton } from '../ui'
import { useCan } from './authContext'

export interface NeedsProps {
  /** Any of these is enough. */
  any: readonly PermissionKey[]
  /** Of the page, also when it is not shown. */
  title: string
  children: ReactNode
}

/** A page only for those who hold a permission. The others load nothing of it. */
export function Needs({ any, title, children }: NeedsProps) {
  const can = useCan()
  if (any.some((key) => can(key))) return <>{children}</>
  return (
    <Page title={title}>
      <EmptyState
        size="page"
        icon="lock"
        headingLevel={2}
        title="You do not have access to this page"
        description="Ask an administrator if you need it."
        action={<LinkButton to="/time">Go to Time</LinkButton>}
      />
    </Page>
  )
}
