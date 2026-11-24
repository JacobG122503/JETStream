import { useState } from 'react'
import { Badge, Button, Menu, type TableColumn, Table, useToast, formatDate } from '../../ui'
import { Example, Section } from './Section'
import { type SampleEntry, sampleEntries } from './sampleData'

const tones = { Draft: 'neutral', Submitted: 'info', Approved: 'success', Rejected: 'danger' } as const
/** The total is that of the rows the table is given. */
const columnsFor = (rows: SampleEntry[]): TableColumn<SampleEntry>[] => [
  { id: 'date', header: 'Date', nowrap: true, cell: (entry) => formatDate(entry.date), sortValue: (entry) => entry.date },
  { id: 'person', header: 'Person', cell: (entry) => entry.person, sortValue: (entry) => entry.person },
  { id: 'project', header: 'Project', cell: (entry) => entry.project, sortValue: (entry) => entry.project },
  { id: 'status', header: 'Status', cell: (entry) => <Badge tone={tones[entry.status]}>{entry.status}</Badge> },
  {
    id: 'hours',
    header: 'Hours',
    numeric: true,
    cell: (entry) => entry.hours?.toFixed(2) ?? 'None',
    sortValue: (entry) => entry.hours,
    total: rows.reduce((sum, entry) => sum + (entry.hours ?? 0), 0).toFixed(2),
  },
]
const fewEntries = sampleEntries.slice(0, 5)
const shared = {
  columns: columnsFor(sampleEntries),
  rowKey: (entry: SampleEntry) => entry.id,
  rowLabel: (entry: SampleEntry) => `${entry.person}, ${formatDate(entry.date)}, ${entry.project}`,
}

export function TablesSection() {
  const toast = useToast()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [status, setStatus] = useState<'loading' | 'error'>('error')
  return (
    <Section id="tables" title="Tables">
      <Example title="Sorting, totals, selection, actions and pages" layout="block" note="Below 640px each row becomes a block.">
        <Table
          {...shared}
          caption="Sample time entries"
          rows={sampleEntries}
          selected={selected}
          onSelectedChange={setSelected}
          rowActions={(entry) => (
            <Menu
              iconOnly
              align="end"
              size="small"
              label={`Actions for ${shared.rowLabel(entry)}`}
              items={[
                { id: 'edit', label: 'Edit', icon: 'edit', onSelect: () => toast.info(`Edit was chosen for ${entry.person}. This is a sample.`) },
                { id: 'copy', label: 'Copy to today', icon: 'copy', disabled: true, onSelect: () => undefined },
                { id: 'delete', label: 'Delete', icon: 'trash', destructive: true, onSelect: () => toast.warning('This is a sample, so nothing was deleted.') },
              ]}
            />
          )}
        />
      </Example>
      <Example title="Sideways scrolling on phones" layout="block">
        <Table {...shared} columns={columnsFor(fewEntries)} caption="Sample entries that scroll sideways" rows={fewEntries} narrow="scroll" />
      </Example>
      <Example title="Loading" layout="block">
        <Table {...shared} caption="Sample entries, loading" rows={[]} status="loading" />
      </Example>
      <Example title="Empty" layout="block">
        <Table
          {...shared}
          caption="Sample entries, empty"
          rows={[]}
          empty={{
            title: 'No time entries',
            description: 'Entries appear here once someone logs time.',
            icon: 'time',
            action: <Button onClick={() => toast.info('This is a sample.')}>Add a sample entry</Button>,
          }}
        />
      </Example>
      <Example title="Error" layout="block">
        <Table
          {...shared}
          caption="Sample entries that cannot be loaded"
          rows={[]}
          status={status}
          error="The sample entries could not be loaded."
          onRetry={() => {
            setStatus('loading')
            setTimeout(() => setStatus('error'), 1500)
          }}
        />
      </Example>
    </Section>
  )
}
