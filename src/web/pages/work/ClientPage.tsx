import { useParams } from 'react-router-dom'
import type { ClientDetails } from '../../../shared/work'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Avatar, Badge, Card, ErrorState, LinkButton, LoadingState, StatTile, Table } from '../../ui'
import { formatHours, formatMoney } from '../../work/format'
import { invoiceColumns } from './invoiceColumns'
import { projectColumns } from './ProjectsPage'
import '../../work/work.css'

export function ClientPage() {
  const { id = '' } = useParams()
  return <ClientLoader key={id} id={id} />
}

function ClientLoader({ id }: { id: string }) {
  const { status, data, error, reload } = useLoad<ClientDetails>(`clients/${encodeURIComponent(id)}`)
  return (
    <Page
      title={data?.name ?? 'Client'}
      description={data?.archived ? <Badge>Archived</Badge> : undefined}
      actions={
        <LinkButton to="/clients" icon="chevronLeft">
          Clients
        </LinkButton>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the client" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error === 'Not found' ? 'There is no such client.' : error} onRetry={reload} />}
      {data && <Client client={data} />}
    </Page>
  )
}

function Client({ client }: { client: ClientDetails }) {
  const { invoices, currency } = client
  const open = (invoices ?? []).filter(({ status }) => status === 'open')
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
        <Card title="Contacts">
          {client.contactList.length === 0 ? (
            <p className="muted">No contacts yet.</p>
          ) : (
            <ul className="contacts">
              {client.contactList.map(({ id, name, title, email, officePhone }) => (
                <li key={id} className="person-cell">
                  <Avatar name={name} decorative />
                  <span className="cell-two">
                    <span>
                      <span className="strong">{name}</span> <span className="muted">{title}</span>
                    </span>
                    <span className="cell-sub">{[email, officePhone].filter(Boolean).join(', ')}</span>
                  </span>
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
            {client.notes && (
              <>
                <dt>Notes</dt>
                <dd className="lines">{client.notes}</dd>
              </>
            )}
          </dl>
        </Card>
      </div>
    </>
  )
}
