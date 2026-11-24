import { Page } from '../../shell/Page'
import { Card, LinkButton } from '../../ui'

/** Shows the layout that signing in and client pages will use. */
export function PlainLayoutPage() {
  return (
    <Page title="Layout without navigation" description="For pages shown to people who are not signed in, and to clients.">
      <Card title="Sample content">
        <p>Content is in one column, with the brand and the appearance control above it.</p>
      </Card>
      <div>
        <LinkButton to="/design">Back to the design system</LinkButton>
      </div>
    </Page>
  )
}
