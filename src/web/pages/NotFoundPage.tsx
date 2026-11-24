import { Page } from '../shell/Page'
import { EmptyState, LinkButton } from '../ui'

export function NotFoundPage() {
  return (
    <Page title="Page not found">
      <EmptyState
        size="page"
        icon="compass"
        headingLevel={2}
        title="There is no page at this address"
        description="Check the address, or choose a section from the menu."
        action={
          <LinkButton to="/time" variant="primary">
            Go to Time
          </LinkButton>
        }
      />
    </Page>
  )
}
