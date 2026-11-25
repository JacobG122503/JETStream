import { Link } from 'react-router-dom'
import type { RoleSummary } from '../../../shared/api'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Badge, LinkButton, Table, type TableColumn } from '../../ui'

const columns: TableColumn<RoleSummary>[] = [
  {
    id: 'name',
    header: 'Role',
    cell: ({ id, name, description }) => (
      <span className="cell-two">
        <Link to={`/settings/roles/${id}`}>{name}</Link>
        <span className="cell-sub">{description}</span>
      </span>
    ),
    sortValue: ({ name }) => name,
  },
  { id: 'kind', header: 'Kind', cell: ({ builtIn }) => (builtIn ? <Badge>Built-in</Badge> : <Badge tone="info">Custom</Badge>), sortValue: ({ builtIn }) => (builtIn ? 0 : 1) },
  { id: 'people', header: 'People', numeric: true, cell: ({ people }) => people, sortValue: ({ people }) => people },
]

export function RolesPage() {
  const { status, data, error, reload } = useLoad<{ roles: RoleSummary[] }>('roles')
  return (
    <Page
      title="Roles"
      description="Each person has one role. Managers can be given extras on their own page."
      actions={
        <>
          <LinkButton to="/settings" icon="chevronLeft">
            Settings
          </LinkButton>
          <LinkButton to="/settings/roles/new" variant="primary" icon="plus">
            New role
          </LinkButton>
        </>
      }
    >
      <Table
        caption="Roles"
        hideCaption
        columns={columns}
        rows={data?.roles ?? []}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        status={status}
        error={error}
        onRetry={reload}
      />
    </Page>
  )
}
