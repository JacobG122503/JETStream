import { useState } from 'react'
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, FilterBar, LoadingState, Menu, PageHeader, ProgressBar, SearchField, Select, Spinner, StatTile, Table, Tabs } from '../../ui'
import { Example, Section } from './Section'
import { longName } from './sampleData'

export function DisplaySection() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  return (
    <Section id="display" title="Display">
      <Example title="Tabs" layout="block" note="Arrow keys, Home and End move between tabs. They scroll when they do not fit.">
        <Tabs
          label="Sample project"
          items={['Overview', 'Tasks', 'Team', 'Budget', 'Expenses', 'Invoices', 'History'].map((label) => ({
            id: label.toLowerCase(),
            label,
            content: <p>Sample content of {label}.</p>,
          }))}
        />
      </Example>
      <Example title="Status badges">
        <Badge>Draft</Badge>
        <Badge tone="info">Submitted</Badge>
        <Badge tone="success">Approved</Badge>
        <Badge tone="warning">Due soon</Badge>
        <Badge tone="danger">Overdue</Badge>
      </Example>
      <Example title="Avatars" note="With a picture, with a picture that cannot be loaded or none, and in three sizes.">
        <Avatar name="Sample Company" src={`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="currentColor" opacity=".35" d="M0 8 8 0v8z"/></svg>')}`} />
        <Avatar name="Dana Whitfield" src="data:image/png;base64,AAAA" />
        <Avatar name="Marcus Oyelaran" size="small" />
        <Avatar name="Priya Raman" />
        <Avatar name="Wen Zhao" size="large" />
      </Example>
      <Example title="Statistic tiles" layout="grid">
        <StatTile label="Sample hours this week" value="31.50" detail="of 40.00 planned" />
        <StatTile label="Sample billable" value="82%" detail={<Badge tone="success">Above target</Badge>} />
        <StatTile label="Sample uninvoiced" value="$12,480.00" />
      </Example>
      <Example title="Card" layout="block">
        <Card title="Sample card" headingLevel={4} actions={<Button size="small">Sample action</Button>}>
          <p>A card groups what belongs together.</p>
        </Card>
      </Example>
      <Example title="Progress" layout="grid">
        <ProgressBar label="Not started" percent={0} detail="0 of 80 hours" />
        <ProgressBar label="Within budget" percent={80} detail="64 of 80 hours" />
        <ProgressBar label="Used up" percent={100} detail="80 of 80 hours" />
        <ProgressBar label="Over" percent={135} detail="108 of 80 hours" />
      </Example>
      <Example title="Page header" layout="block">
        <PageHeader
          title="Sample invoices"
          headingLevel={3}
          description="A title, what the page is for, and its main actions."
          actions={
            <>
              <Button>Export sample</Button>
              <Button variant="primary" icon="plus">
                New sample
              </Button>
            </>
          }
        />
      </Example>
      <Example title="Filter bar" layout="block">
        <FilterBar
          label="Filter samples"
          actions={
            <Button
              variant="quiet"
              onClick={() => {
                setSearch('')
                setStatus('')
              }}
            >
              Clear filters
            </Button>
          }
        >
          <SearchField label="Search samples" value={search} onChange={setSearch} />
          <Select
            label="Sample status"
            placeholder="Any"
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'sent', label: 'Sent' },
            ]}
            value={status}
            onChange={setStatus}
          />
        </FilterBar>
      </Example>
    </Section>
  )
}

export function StatesSection() {
  const [retries, setRetries] = useState(0)
  const [crash, setCrash] = useState(false)
  if (crash) throw new Error('Sample error: raised on purpose in the gallery')
  return (
    <Section id="states" title="Loading, empty and error">
      <Example title="Loading">
        <Spinner label="Loading samples" />
      </Example>
      <Example title="Loading a section" layout="grid">
        <LoadingState label="Loading sample section" />
        <LoadingState label="Loading sample lines" look="skeleton" />
      </Example>
      <Example title="Loading a page" layout="block">
        <LoadingState label="Loading sample page" size="page" />
        <LoadingState label="Loading sample page lines" size="page" look="skeleton" />
      </Example>
      <Example title="Empty" layout="grid">
        <EmptyState title="No sample projects" headingLevel={4} icon="projects" description="Projects you add appear here." action={<Button variant="primary">Add a sample project</Button>} />
        <EmptyState title="No sample results" description="Try fewer filters." icon="search" />
      </Example>
      <Example title="Empty page" layout="block">
        <EmptyState size="page" headingLevel={4} title="No sample reports" icon="reports" description="For a page that has nothing on it yet." />
      </Example>
      <Example title="Error" layout="block">
        <ErrorState headingLevel={4} title="Samples could not be loaded" message={`The sample server did not answer. Tried again ${retries} times.`} onRetry={() => setRetries(retries + 1)} />
        <ErrorState size="page" message="For a whole page." onRetry={() => setRetries(retries + 1)} />
      </Example>
      <Example title="Error while a page renders" note="Shown in place of the page. Navigation still works, and Try again brings the gallery back.">
        <Button variant="destructive" onClick={() => setCrash(true)}>
          Break this page
        </Button>
      </Example>
    </Section>
  )
}

export function LongTextSection() {
  return (
    <Section id="long-text" title="Long text">
      <Example title="A name of 120 characters without a space" layout="block">
        <PageHeader title={longName} headingLevel={3} description={longName} />
        <Table
          caption="Sample table with a long name"
          hideCaption
          columns={[
            { id: 'name', header: 'Project', cell: (row: { name: string }) => row.name },
            { id: 'status', header: 'Status', cell: () => <Badge tone="info">{longName}</Badge> },
            { id: 'hours', header: 'Hours', cell: () => '8.00', numeric: true },
          ]}
          rows={[{ name: longName }]}
          rowKey={(row) => row.name}
          rowLabel={(row) => row.name}
        />
        <Badge tone="warning">{longName}</Badge>
        <div>
          <Menu label="Menu with a long item" items={[{ id: 'long', label: longName, icon: 'projects', onSelect: () => undefined }]} />
        </div>
        <ProgressBar label={longName} percent={40} />
      </Example>
    </Section>
  )
}
