import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ClientDetails, Contact } from '../../../shared/work'
import { callApi } from '../../api'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Badge, Button, Card, ErrorState, IconButton, LinkButton, LoadingState, Menu, StatTile, Table, useToast } from '../../ui'
import { currencies, taxFields, termFields, termLabels } from '../../work/billing'
import { type FieldSpec, FormDialog } from '../../work/FormDialog'
import { formatHours, formatMoney } from '../../work/format'
import { useActions } from '../../work/useActions'
import { invoiceColumns } from './invoiceColumns'
import { projectColumns } from './ProjectsPage'
import '../../work/work.css'

export function ClientPage() {
  const { id = '' } = useParams()
  return <ClientLoader key={id} id={id} />
}

function ClientLoader({ id }: { id: string }) {
  const { status, data, error, reload, refresh, setData } = useLoad<ClientDetails>(`clients/${encodeURIComponent(id)}`)
  const [editing, setEditing] = useState(false)
  const { ask, dialog } = useActions()
  const navigate = useNavigate()
  const toast = useToast()
  return (
    <Page
      title={data?.name ?? 'Client'}
      description={data?.archived ? <Badge>Archived</Badge> : undefined}
      actions={
        <>
          <LinkButton to="/clients" icon="chevronLeft">
            Clients
          </LinkButton>
          {data?.canManage && (
            <>
              <Menu
                label="More"
                items={[
                  {
                    id: 'archive',
                    label: data.archived ? 'Restore' : 'Archive',
                    onSelect: () =>
                      ask({
                        title: data.archived ? 'Restore this client?' : 'Archive this client?',
                        message: data.archived ? 'It can be used for new work again.' : 'Its history stays. It is not offered for new work.',
                        confirmLabel: data.archived ? 'Restore' : 'Archive',
                        route: `clients/${data.id}/archive`,
                        body: { archive: !data.archived },
                        done: data.archived ? 'Client restored' : 'Client archived',
                        then: refresh,
                      }),
                  },
                  {
                    id: 'delete',
                    label: 'Delete',
                    destructive: true,
                    onSelect: () =>
                      ask({
                        title: 'Delete this client?',
                        message: `Its ${data.contactList.length} contacts go with it. Only a client without projects and invoices can be deleted.`,
                        confirmLabel: 'Delete client',
                        destructive: true,
                        method: 'DELETE',
                        route: `clients/${data.id}`,
                        done: 'Client deleted',
                        then: () => navigate('/clients'),
                      }),
                  },
                ]}
              />
              <Button icon="edit" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          )}
        </>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the client" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error === 'Not found' ? 'There is no such client.' : error} onRetry={reload} />}
      {data && <Client client={data} onChange={refresh} />}
      {data && editing && (
        <FormDialog
          title="Edit client"
          submitLabel="Save client"
          initial={{ ...data, ...data.billing }}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'currency', label: 'Currency', type: 'select', options: currencies.map((value) => ({ value, label: value })), disabled: data.currencyLocked !== null, hint: data.currencyLocked ?? undefined },
            { name: 'address', label: 'Address', type: 'area' },
            ...termFields,
            ...taxFields,
            { name: 'discountPercent', label: 'Discount, percent', type: 'percent' },
            { name: 'notes', label: 'Notes', type: 'area' },
          ]}
          onClose={() => setEditing(false)}
          onReload={reload}
          onSubmit={async (values) => {
            setData(await callApi<ClientDetails>('PUT', `clients/${data.id}`, { ...values, version: data.version }))
            setEditing(false)
            toast.success('Client saved')
          }}
        />
      )}
      {dialog}
    </Page>
  )
}

const contactFields: FieldSpec[] = [
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'title', label: 'Job title', type: 'text' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'officePhone', label: 'Office phone', type: 'text', half: true },
  { name: 'mobilePhone', label: 'Mobile phone', type: 'text', half: true },
]

const digits = (phone: string) => (phone.startsWith('+') ? '+' : '') + phone.replace(/\D/g, '')

function Client({ client, onChange }: { client: ClientDetails; onChange: () => void }) {
  const { invoices, currency, billing, canManage } = client
  const [contact, setContact] = useState<Contact | 'new' | null>(null)
  const { ask, dialog } = useActions()
  const toast = useToast()
  const open = (invoices ?? []).filter(({ status }) => status === 'open')
  const percent = (value: number | null) => (value === null ? '' : ` ${value / 1000}%`)
  return (
    <>
      <div className="tiles">
        <StatTile label="Active projects" value={String(client.activeProjects)} detail={`${client.projects.length} in all that you can see`} />
        <StatTile label="Hours" value={formatHours(client.minutes)} detail="on all projects" />
        {invoices && (
          <StatTile
            label="Outstanding"
            value={formatMoney(open.reduce((sum, { dueAmount }) => sum + dueAmount, 0), currency, { whole: true })}
            detail={`${open.filter(({ late }) => late).length} of ${open.length} open invoices late`}
          />
        )}
      </div>
      <Table
        caption="Projects"
        columns={projectColumns}
        rows={client.projects}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        empty={{ icon: 'projects', title: 'No projects', description: 'There are no projects for this client that you can see.' }}
      />
      {invoices && (
        <Table
          caption="Invoices"
          columns={invoiceColumns.filter(({ id }) => id !== 'client')}
          rows={invoices}
          rowKey={({ id }) => String(id)}
          rowLabel={({ number }) => number}
          pageSize={10}
          empty={{ icon: 'invoices', title: 'No invoices', description: 'This client has not been invoiced yet.' }}
        />
      )}
      <div className="columns">
        <Card
          title="Contacts"
          actions={
            canManage && (
              <Button size="small" icon="plus" onClick={() => setContact('new')}>
                Add contact
              </Button>
            )
          }
        >
          {client.contactList.length === 0 ? (
            <p className="muted">No contacts yet.</p>
          ) : (
            <ul className="contacts">
              {client.contactList.map((one) => (
                <li key={one.id} className="contact">
                  <span className="cell-two">
                    <span>
                      <span className="strong">{one.name}</span> <span className="muted">{one.title}</span>
                    </span>
                    <span className="cell-sub facts-line">
                      {one.email && <a href={`mailto:${encodeURIComponent(one.email).replace('%40', '@')}`}>{one.email}</a>}
                      {one.officePhone && <a href={`tel:${digits(one.officePhone)}`}>{one.officePhone}</a>}
                      {one.mobilePhone && <a href={`tel:${digits(one.mobilePhone)}`}>{one.mobilePhone}</a>}
                    </span>
                  </span>
                  {canManage && (
                    <span className="row-actions">
                      <IconButton size="small" variant="quiet" icon="edit" label={`Edit ${one.name}`} onClick={() => setContact(one)} />
                      <IconButton
                        size="small"
                        variant="quiet"
                        icon="trash"
                        label={`Delete ${one.name}`}
                        onClick={() =>
                          ask({
                            title: `Delete ${one.name}?`, message: 'Messages and invoices sent to this contact stay as they are.', confirmLabel: 'Delete contact', destructive: true,
                            method: 'DELETE', route: `clients/${client.id}/contacts/${one.id}`, done: 'Contact deleted', then: onChange,
                          })
                        }
                      />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Details">
          <dl className="facts">
            <dt>Currency</dt>
            <dd>{currency}</dd>
            <dt>Address</dt>
            <dd className="lines">{client.address || 'Not entered'}</dd>
            {billing && (
              <>
                <dt>Terms</dt>
                <dd>{billing.paymentTerms === 'custom' ? `${billing.paymentTermDays} days` : termLabels[billing.paymentTerms]}</dd>
                <dt>Taxes</dt>
                <dd>
                  {[billing.tax1Percent !== null && `${billing.tax1Name ?? 'Tax'}${percent(billing.tax1Percent)}`, billing.tax2Percent !== null && `${billing.tax2Name ?? 'Tax'}${percent(billing.tax2Percent)}`]
                    .filter(Boolean)
                    .join(', ') || 'None'}
                </dd>
                <dt>Discount</dt>
                <dd>{percent(billing.discountPercent) || 'None'}</dd>
              </>
            )}
            {client.notes && (
              <>
                <dt>Notes</dt>
                <dd className="lines">{client.notes}</dd>
              </>
            )}
          </dl>
        </Card>
      </div>
      {contact && (
        <FormDialog
          title={contact === 'new' ? 'Add contact' : 'Edit contact'}
          submitLabel="Save contact"
          initial={contact === 'new' ? {} : { ...contact }}
          fields={contactFields}
          onClose={() => setContact(null)}
          onReload={onChange}
          onSubmit={async (values) => {
            if (contact === 'new') await callApi('POST', `clients/${client.id}/contacts`, values)
            else await callApi('PUT', `clients/${client.id}/contacts/${contact.id}`, { ...values, version: contact.version })
            setContact(null)
            onChange()
            toast.success('Contact saved')
          }}
        />
      )}
      {dialog}
    </>
  )
}
