import { type FormEvent, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ClientRow } from '../../../shared/work'
import { callApi } from '../../api'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Avatar, Badge, Button, Dialog, EmptyState, ErrorState, FilterBar, LoadingState, SearchField, Select, TextArea, TextField, useToast } from '../../ui'
import { formatDecimalHours } from '../../work/format'
import '../../work/work.css'

export function ClientsPage() {
  const { status, data, error, reload } = useLoad<{ clients: ClientRow[]; canManage: boolean }>('clients')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const rows = (data?.clients ?? []).filter(({ name }) => name.toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <Page
      title="Clients"
      description="The companies we work for."
      actions={
        data?.canManage && (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New client
          </Button>
        )
      }
    >
      <FilterBar label="Filter clients">
        <SearchField label="Search clients" hideLabel placeholder="Client" value={search} onChange={setSearch} />
      </FilterBar>
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading clients" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && rows.length === 0 && <EmptyState icon="clients" headingLevel={2} title="No clients" description="There is no client to show." />}
      <ul className="cards">
        {rows.map((client) => (
          <li key={client.id}>
            <Link to={`/clients/${client.id}`} className="client-card">
              <span className="client-head">
                <Avatar name={client.name} decorative />
                <span className="cell-two">
                  <span className="strong">{client.name}</span>
                  <span className="cell-sub">{client.currency}</span>
                </span>
                {client.archived && <Badge>Archived</Badge>}
              </span>
              <span className="client-facts">
                <span>
                  <strong className="figure">{client.activeProjects}</strong> active projects
                </span>
                <span>
                  <strong className="figure">{formatDecimalHours(client.minutes)}</strong> in all
                </span>
                <span>
                  <strong className="figure">{client.contacts}</strong> contacts
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {creating && <NewClient onClose={() => setCreating(false)} />}
    </Page>
  )
}

const fields = ['name', 'currency', 'address'] as const
const currencies = ['USD', 'EUR', 'CAD', 'GBP', 'MXN', 'AUD', 'CHF', 'JPY']

function NewClient({ onClose }: { onClose: () => void }) {
  const formId = useId()
  const toast = useToast()
  const navigate = useNavigate()
  const form = useForm('client', fields)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [address, setAddress] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        const { id } = await callApi<{ id: number }>('POST', 'clients', { name, currency, address })
        toast.success('Client created')
        navigate(`/clients/${id}`)
      },
      { name: name.trim() === '' ? 'Enter a name.' : null },
    )
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="New client"
      closeOnOutsidePress={false}
      busy={form.busy}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={form.busy} loadingLabel="Creating the client">
            Create client
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" noValidate onSubmit={submit}>
        <FormMessages form={form} />
        <TextField label="Name" required value={name} onChange={setName} {...form.field('name')} />
        <Select label="Currency" value={currency} options={currencies.map((value) => ({ value, label: value }))} onChange={setCurrency} {...form.field('currency')} />
        <TextArea label="Address" rows={3} value={address} onChange={setAddress} {...form.field('address')} />
      </form>
    </Dialog>
  )
}
