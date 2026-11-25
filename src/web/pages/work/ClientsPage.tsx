import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ClientRow } from '../../../shared/work'
import { callApi } from '../../api'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Badge, Button, FilterBar, SearchField, Select, Table, type TableColumn, useToast } from '../../ui'
import { currencies } from '../../work/billing'
import { FormDialog } from '../../work/FormDialog'
import { formatHours, getFormats } from '../../work/format'
import '../../work/work.css'

export function ClientsPage() {
  const { status, data, error, reload } = useLoad<{ clients: ClientRow[]; canManage: boolean }>('clients')
  const [search, setSearch] = useState('')
  const [show, setShow] = useState('active')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const wanted = search.trim().toLowerCase()
  const rows = (data?.clients ?? []).filter(
    ({ name, contactNames, archived }) => (show === 'all' || archived === (show === 'archived')) && `${name}\n${contactNames.join('\n')}`.toLowerCase().includes(wanted),
  )
  const columns: TableColumn<ClientRow>[] = [
    {
      id: 'name',
      header: 'Client',
      cell: ({ id, name, archived, contactNames }) => {
        const contact = wanted && !name.toLowerCase().includes(wanted) ? contactNames.find((one) => one.toLowerCase().includes(wanted)) : undefined
        return (
          <span className="cell-two">
            <span>
              <Link to={`/clients/${id}`}>{name}</Link> {archived && <Badge>Archived</Badge>}
            </span>
            {contact && <span className="cell-sub">Contact: {contact}</span>}
          </span>
        )
      },
      sortValue: ({ name }) => name,
    },
    { id: 'currency', header: 'Currency', cell: ({ currency }) => currency, sortValue: ({ currency }) => currency },
    { id: 'contacts', header: 'Contacts', numeric: true, cell: ({ contacts }) => contacts, sortValue: ({ contacts }) => contacts },
    { id: 'projects', header: 'Active projects', numeric: true, cell: ({ activeProjects }) => activeProjects, sortValue: ({ activeProjects }) => activeProjects },
    { id: 'hours', header: 'Hours', numeric: true, cell: ({ minutes }) => formatHours(minutes), sortValue: ({ minutes }) => minutes },
  ]
  return (
    <Page
      title="Clients"
      actions={
        data?.canManage && (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New client
          </Button>
        )
      }
    >
      <FilterBar label="Filter clients">
        <SearchField label="Search clients" hideLabel placeholder="Client or contact" value={search} onChange={setSearch} />
        <Select
          label="Show"
          hideLabel
          value={show}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
            { value: 'all', label: 'All' },
          ]}
          onChange={setShow}
        />
      </FilterBar>
      <Table
        caption="Clients"
        hideCaption
        columns={columns}
        rows={rows}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        status={status}
        error={error}
        onRetry={reload}
        defaultSort={{ columnId: 'name', direction: 'ascending' }}
        empty={{ icon: 'clients', title: 'No clients', description: search ? 'No client or contact has this name.' : 'There is no client to show.' }}
      />
      {creating && (
        <FormDialog
          title="New client"
          submitLabel="Create client"
          initial={{ currency: getFormats().currency }}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'currency', label: 'Currency', type: 'select', options: currencies.map((value) => ({ value, label: value })) },
            { name: 'address', label: 'Address', type: 'area' },
          ]}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => {
            const { id } = await callApi<{ id: number }>('POST', 'clients', values)
            toast.success('Client created')
            navigate(`/clients/${id}`)
          }}
        />
      )}
    </Page>
  )
}

