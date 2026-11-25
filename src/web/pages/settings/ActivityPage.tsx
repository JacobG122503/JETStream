import { useState } from 'react'
import type { ActivityRow } from '../../../shared/work'
import { usePerson, useWeekStart } from '../../auth/authContext'
import { formatInstant } from '../../auth/timeZones'
import { useLoad } from '../../auth/useLoad'
import { Button, DatePicker, FilterBar, SearchField, Select, Table, type TableColumn } from '../../ui'
import { downloadCsv } from '../../work/csv'
import { SettingsLayout } from './SettingsLayout'

const types = ['person', 'role', 'client', 'project', 'task', 'time', 'expense', 'submission', 'invoice', 'estimate', 'retainer', 'settings', 'time_off', 'assignment', 'import']

export function ActivityPage() {
  const { timeZone } = usePerson()
  const weekStart = useWeekStart()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const query = new URLSearchParams({ search, type, from, to }).toString()
  const { status, data, error, reload } = useLoad<{ rows: ActivityRow[]; more: boolean }>(`activity?${query}`)
  const rows = data?.rows ?? []
  const columns: TableColumn<ActivityRow>[] = [
    { id: 'at', header: 'When', nowrap: true, cell: ({ at }) => formatInstant(at, timeZone), sortValue: ({ at }) => at },
    { id: 'who', header: 'Who', cell: ({ actor }) => actor ?? 'System', sortValue: ({ actor }) => actor ?? '' },
    { id: 'what', header: 'What', cell: ({ summary }) => summary, sortValue: ({ summary }) => summary },
    { id: 'type', header: 'About', cell: ({ type: about }) => about.replaceAll('_', ' '), sortValue: ({ type: about }) => about },
  ]
  return (
    <SettingsLayout
      title="Activity log"
      current="/settings/activity"
      actions={
        <Button aria-disabled={rows.length === 0 || undefined} onClick={() => downloadCsv('activity', [['When', 'Who', 'What', 'About'], ...rows.map((row) => [row.at, row.actor ?? 'System', row.summary, row.type])])}>
          Export CSV
        </Button>
      }
    >
      <div className="stack">
        <FilterBar label="Filter activity">
          <SearchField label="Search activity" hideLabel placeholder="Who or what" value={search} onChange={setSearch} />
          <Select label="About" hideLabel value={type} options={[{ value: '', label: 'Everything' }, ...types.map((value) => ({ value, label: value.replaceAll('_', ' ') }))]} onChange={setType} />
          <DatePicker label="From" weekStart={weekStart} value={from} onChange={setFrom} />
          <DatePicker label="To" weekStart={weekStart} value={to} onChange={setTo} />
        </FilterBar>
        {data?.more && <p className="muted">The newest 500 are shown. Choose a period to see others.</p>}
        <Table
          caption="Activity"
          hideCaption
          columns={columns}
          rows={rows}
          rowKey={({ id }) => String(id)}
          rowLabel={({ summary }) => summary}
          status={status}
          error={error}
          onRetry={reload}
          empty={{ icon: 'inbox', title: 'Nothing found', description: 'Nothing like this was recorded.' }}
        />
      </div>
    </SettingsLayout>
  )
}
