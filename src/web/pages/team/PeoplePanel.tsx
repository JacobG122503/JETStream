import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PersonRow } from '../../../shared/api'
import { useLoad } from '../../auth/useLoad'
import { photoUrl } from '../../shell/AccountMenu'
import { Avatar, SearchField, Table, type TableColumn } from '../../ui'
import { signInLabels } from './labels'
import { StatusBadge } from './StatusBadge'

const columns: TableColumn<PersonRow>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: ({ id, name, photoId }) => (
      <span className="person-cell">
        <Avatar name={name} src={photoUrl(photoId)} size="small" decorative />
        <span>
          <Link to={`/team/${id}`}>{name}</Link>
        </span>
      </span>
    ),
    sortValue: ({ name }) => name,
  },
  { id: 'email', header: 'Email', cell: ({ email }) => email, sortValue: ({ email }) => email },
  { id: 'role', header: 'Role', cell: ({ role }) => role, sortValue: ({ role }) => role },
  { id: 'status', header: 'Status', cell: ({ status }) => <StatusBadge status={status} />, sortValue: ({ status }) => status },
  { id: 'signIn', header: 'Sign-in', cell: ({ signIn }) => signInLabels[signIn], sortValue: ({ signIn }) => signInLabels[signIn] },
]

export function PeoplePanel() {
  const { status, data, error, reload } = useLoad<{ people: PersonRow[] }>('people')
  const [search, setSearch] = useState('')
  const rows = useMemo(() => {
    const wanted = search.trim().toLowerCase()
    return (data?.people ?? []).filter(({ name, email, role }) => `${name}\n${email}\n${role}`.toLowerCase().includes(wanted))
  }, [data, search])

  return (
    <div className="panel">
      <SearchField label="Search people" placeholder="Name, email or role" value={search} onChange={setSearch} />
      <Table
        caption="People"
        hideCaption
        columns={columns}
        rows={rows}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        status={status}
        error={error}
        onRetry={reload}
        empty={{ icon: 'team', title: 'No matches', description: 'Nobody has this name, email or role.' }}
        defaultSort={{ columnId: 'name', direction: 'ascending' }}
      />
    </div>
  )
}
