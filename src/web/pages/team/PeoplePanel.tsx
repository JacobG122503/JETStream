import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PersonRow } from '../../../shared/api'
import { useCan } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { photoUrl } from '../../shell/photo'
import { Avatar, SearchField, Table, type TableColumn } from '../../ui'
import { signInLabels } from './labels'
import { StatusBadge } from './StatusBadge'

const baseColumns: TableColumn<PersonRow>[] = [
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
]

const signInText = ({ signIn }: PersonRow) => (signIn ? signInLabels[signIn] : '')
/** Only for those who manage people. */
const signInColumn: TableColumn<PersonRow> = { id: 'signIn', header: 'Sign-in', cell: signInText, sortValue: signInText }

export function PeoplePanel() {
  const manages = useCan()('people.manage')
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
        columns={manages ? [...baseColumns, signInColumn] : baseColumns}
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
