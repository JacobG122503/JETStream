import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { EstimateDetails, EstimateRow } from '../../../shared/billing'
import { productName } from '../../../shared/product'
import { callApi, errorMessage } from '../../api'
import { useAuth, usePerson } from '../../auth/authContext'
import { formatInstant } from '../../auth/timeZones'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Badge, Button, Card, ErrorState, formatDate, LinkButton, LoadingState, Menu, Table, Tabs, useToast } from '../../ui'
import { FormDialog } from '../../work/FormDialog'
import { formatMoney } from '../../work/format'
import { LinkDialog } from '../../work/LinkDialog'
import { MessageDialog } from '../../work/MessageDialog'
import { MessageHistory } from '../../work/MessageHistory'
import { PrintedDocument } from '../../work/PrintedDocument'
import { useActions } from '../../work/useActions'
import '../../work/work.css'

function EstimateBadge({ estimate: { status, expired } }: { estimate: Pick<EstimateRow, 'status' | 'expired'> }) {
  if (expired) return <Badge tone="warning">Expired</Badge>
  if (status === 'accepted') return <Badge tone="success">Accepted</Badge>
  if (status === 'declined') return <Badge tone="danger">Declined</Badge>
  return status === 'sent' ? <Badge tone="info">Sent</Badge> : <Badge>Draft</Badge>
}

const views: { id: string; label: string; shows: (estimate: EstimateRow) => boolean }[] = [
  { id: 'all', label: 'All', shows: () => true },
  { id: 'draft', label: 'Drafts', shows: ({ status }) => status === 'draft' },
  { id: 'sent', label: 'Sent', shows: ({ status }) => status === 'sent' },
  { id: 'accepted', label: 'Accepted', shows: ({ status }) => status === 'accepted' },
  { id: 'declined', label: 'Declined', shows: ({ status }) => status === 'declined' },
]

export function EstimatesPage() {
  const [query, setQuery] = useSearchParams()
  const { status, data, error, reload } = useLoad<{ estimates: EstimateRow[] }>('estimates')
  const estimates = data?.estimates ?? []
  return (
    <Page
      title="Estimates"
      description="What work would cost, for clients to accept."
      actions={
        <LinkButton to="/estimates/new" variant="primary" icon="plus">
          New estimate
        </LinkButton>
      }
    >
      <Tabs
        label="Estimates"
        value={query.get('show') ?? 'all'}
        onChange={(show) => setQuery(show === 'all' ? {} : { show }, { replace: true })}
        items={views.map(({ id, label, shows }) => ({
          id,
          label: data && id !== 'all' ? `${label} (${estimates.filter(shows).length})` : label,
          content: (
            <Table
              caption="Estimates"
              hideCaption
              status={status}
              error={error}
              onRetry={reload}
              rows={estimates.filter(shows)}
              rowKey={(estimate) => String(estimate.id)}
              rowLabel={({ number }) => number}
              columns={[
                { id: 'number', header: 'Estimate', cell: (estimate) => <span className="cell-two"><Link to={`/estimates/${estimate.id}`}>{estimate.number}</Link><span className="cell-sub">{estimate.subject}</span></span>, sortValue: ({ number }) => number },
                { id: 'client', header: 'Client', cell: ({ client }) => client.name, sortValue: ({ client }) => client.name },
                { id: 'status', header: 'Status', cell: (estimate) => <EstimateBadge estimate={estimate} />, sortValue: ({ status: is }) => is },
                { id: 'issued', header: 'Issued', nowrap: true, cell: ({ issuedOn }) => formatDate(issuedOn), sortValue: ({ issuedOn }) => issuedOn },
                { id: 'expires', header: 'Expires', nowrap: true, cell: ({ expiresOn }) => (expiresOn === null ? <span className="muted">-</span> : formatDate(expiresOn)), sortValue: ({ expiresOn }) => expiresOn ?? '' },
                { id: 'total', header: 'Total', numeric: true, cell: ({ total, currency }) => formatMoney(total, currency), sortValue: ({ total }) => total },
              ]}
              empty={{ icon: 'estimates', title: 'No estimates', description: 'There are none of this kind.' }}
            />
          ),
        }))}
      />
    </Page>
  )
}

export function EstimatePage() {
  const { id = '' } = useParams()
  return <EstimateLoader key={id} id={id} />
}

type Open = 'message' | 'note' | 'answer' | 'project' | { link: string } | null

function EstimateLoader({ id }: { id: string }) {
  const { status, data, error, reload, setData } = useLoad<EstimateDetails>(`estimates/${encodeURIComponent(id)}`)
  const { info } = useAuth()
  const { timeZone } = usePerson()
  const [open, setOpen] = useState<Open>(null)
  const { ask, run, dialog } = useActions()
  const toast = useToast()
  const navigate = useNavigate()
  const route = `estimates/${id}`
  const close = () => setOpen(null)
  const post = async (path: string, body: object, message: string) => {
    setData(await callApi<EstimateDetails>('POST', `${route}/${path}`, body))
    close()
    toast.success(message)
  }
  const version = data?.version
  const menu = data
    ? [
        ...(data.status === 'draft'
          ? [{ id: 'mark', label: 'Mark as sent', onSelect: () => ask({ title: 'Mark as sent?', message: `${productName} sends nothing: send it to the client yourself.`, confirmLabel: 'Mark as sent', route: `${route}/send`, body: { version }, done: 'Marked as sent', then: setData }) }]
          : [
              { id: 'again', label: 'Send again', onSelect: () => setOpen('message') },
              {
                id: 'link', label: 'Make a client link',
                onSelect: () => {
                  callApi<{ link: string }>('POST', `${route}/link`).then(setOpen, (reason: unknown) => toast.error(errorMessage(reason)))
                },
              },
              { id: 'answer', label: 'Record an answer', onSelect: () => setOpen('answer') },
            ]),
        ...(data.links.length > 0 ? [{ id: 'revoke', label: 'Revoke client links', onSelect: () => ask({ title: 'Revoke all links?', message: 'Clients can no longer open the estimate with them.', confirmLabel: 'Revoke all', destructive: true, route: `${route}/revoke-links`, done: 'Links revoked', then: setData }) }] : []),
        ...(data.canCreateProject ? [{ id: 'project', label: 'Create a project', onSelect: () => setOpen('project') }] : []),
        { id: 'note', label: 'Add a note', onSelect: () => setOpen('note') },
        { id: 'duplicate', label: 'Duplicate', onSelect: () => void run('POST', `${route}/duplicate`, undefined, 'Draft created', ({ id: copy }: { id: number }) => navigate(`/estimates/${copy}`)) },
        { id: 'delete', label: 'Delete', destructive: true, onSelect: () => ask({ title: `Delete estimate ${data.number}?`, message: 'What was made from it stays. The number is not used again.', confirmLabel: 'Delete estimate', destructive: true, route: `${route}/delete`, body: { version }, done: 'Estimate deleted', then: () => navigate('/estimates') }) },
      ]
    : []
  return (
    <Page
      title={data ? `Estimate ${data.number}` : 'Estimate'}
      description={
        data && (
          <span className="facts-line">
            <EstimateBadge estimate={data} />
            <Link to={`/clients/${data.client.id}`}>{data.client.name}</Link>
            {data.invoice && (
              <span>
                Invoice <Link to={`/invoices/${data.invoice.id}`}>{data.invoice.number}</Link>
              </span>
            )}
            {data.project && (
              <span>
                Project <Link to={`/projects/${data.project.id}`}>{data.project.name}</Link>
              </span>
            )}
          </span>
        )
      }
      actions={
        <>
          <LinkButton to="/estimates" icon="chevronLeft">
            Estimates
          </LinkButton>
          {data && (
            <>
              <Button icon="printer" onClick={() => window.print()}>
                Print or PDF
              </Button>
              <Menu label="More" align="end" items={menu} />
              <LinkButton to={`/estimates/${data.id}/edit`} icon="edit">
                Edit
              </LinkButton>
              {data.status === 'draft' && (
                <Button variant="primary" icon="send" onClick={() => setOpen('message')}>
                  Send
                </Button>
              )}
              {data.status === 'accepted' && data.canInvoice && (
                <Button variant="primary" onClick={() => void run('POST', `${route}/invoice`, { version }, 'Draft invoice created', ({ id: invoice }: { id: number }) => navigate(`/invoices/${invoice}`))}>
                  Create invoice
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the estimate" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error === 'Not found' ? 'There is no such estimate.' : error} onRetry={reload} />}
      {data && (
        <>
          <PrintedDocument word="Estimate" document={data} facts={data.expiresOn === null ? [] : [{ label: 'Valid until', value: formatDate(data.expiresOn) }]} />
          {data.answers.length > 0 && (
            <Card title="Answers">
              <ul className="payments">
                {data.answers.map(({ id: answerId, answer, name, comment, at, byClient }) => (
                  <li key={answerId}>
                    <span className="cell-two">
                      <span>
                        <span className="strong">{answer === 'accepted' ? 'Accepted' : 'Declined'}</span> <span className="muted">{[name, byClient ? 'through the link' : 'recorded by hand'].filter(Boolean).join(', ')}</span>
                      </span>
                      <span className="cell-sub lines">{comment}</span>
                    </span>
                    <span className="muted">{formatInstant(at, timeZone)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <MessageHistory messages={data.messages} />
        </>
      )}
      {data && open === 'message' && (
        <MessageDialog title="Send estimate" submitLabel="Send" kind="sent" route={`${route}/message`} contacts={data.contacts} onClose={close} onSend={(message) => post('messages', { ...message, version: data.version }, info?.emailDelivers ? 'Sent' : 'Kept in the Outbox')} />
      )}
      {data && open === 'note' && (
        <FormDialog title="Add a note" submitLabel="Add note" intro={<p className="muted">Only your company sees it.</p>} fields={[{ name: 'body', label: 'Note', type: 'area', required: true }]} onClose={close} onReload={reload} onSubmit={(values) => post('messages', { ...values, kind: 'note', recipients: [], subject: '', version: data.version }, 'Note added')} />
      )}
      {data && open === 'answer' && (
        <FormDialog
          title="Record an answer"
          submitLabel="Record answer"
          intro={<p className="muted">For an answer that came some other way, such as on the phone.</p>}
          initial={{ answer: 'accepted' }}
          fields={[
            { name: 'answer', label: 'Answer', type: 'select', options: [{ value: 'accepted', label: 'Accepted' }, { value: 'declined', label: 'Declined' }] },
            { name: 'name', label: 'Who answered', type: 'text' },
            { name: 'comment', label: 'Comment', type: 'area', rows: 2 },
          ]}
          onClose={close}
          onReload={reload}
          onSubmit={(values) => post('answer', { ...values, version: data.version }, 'Answer recorded')}
        />
      )}
      {data && open === 'project' && (
        <FormDialog
          title="Create a project"
          submitLabel="Create project"
          intro={<p className="muted">It gets the common tasks, and you manage it.</p>}
          initial={{ name: data.subject || data.number }}
          fields={[{ name: 'name', label: 'Name', type: 'text', required: true }]}
          onClose={close}
          onReload={reload}
          onSubmit={async (values) => {
            const { id: project } = await callApi<{ id: number }>('POST', `${route}/project`, { ...values, version: data.version })
            navigate(`/projects/${project}`)
          }}
        />
      )}
      {open !== null && typeof open === 'object' && (
        <LinkDialog
          link={open.link}
          onClose={() => {
            close()
            reload()
          }}
        />
      )}
      {dialog}
    </Page>
  )
}
