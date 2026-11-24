import { Page } from '../shell/Page'
import type { NavItem } from '../shell/navigation'
import { EmptyState } from '../ui'

/** Stands in for a section until its own task builds it. */
export function SectionPage({ item }: { item: NavItem }) {
  return (
    <Page title={item.label}>
      <EmptyState
        size="page"
        icon={item.icon}
        headingLevel={2}
        title="Not available yet"
        description={`The ${item.label} section has not been built yet, so there is nothing to do here for now.`}
      />
    </Page>
  )
}
