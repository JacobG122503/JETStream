import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { DocumentClient, DocumentOptions, EstimateDetails, InvoiceDetails, RecurringDetails } from '../../../shared/billing'
import { callApi } from '../../api'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { addDays, Combobox, EmptyState, ErrorState, LinkButton, LoadingState, useToast } from '../../ui'
import { termFields, termOptions } from '../../work/billing'
import { DocumentEditor } from '../../work/DocumentEditor'
import type { FieldSpec } from '../../work/FormDialog'
import '../../work/work.css'

const headSpecs: FieldSpec[] = [
  { name: 'subject', label: 'Subject', type: 'text', half: true },
  { name: 'purchaseOrder', label: 'Purchase order', type: 'text', half: true },
]

const invoiceSpecs: FieldSpec[] = [
  ...headSpecs,
  { name: 'number', label: 'Number', type: 'text', hint: 'Empty for the next one.', half: true },
  { name: 'issuedOn', label: 'Issued', type: 'date', required: true, half: true },
  { name: 'paymentTerms', label: 'Payment terms', type: 'select', options: termOptions, half: true },
  { name: 'dueOn', label: 'Due', type: 'date', required: true, show: ({ paymentTerms }) => paymentTerms === 'custom', half: true },
]

const estimateSpecs: FieldSpec[] = [
  ...headSpecs,
  { name: 'number', label: 'Number', type: 'text', hint: 'Empty for the next one.', half: true },
  { name: 'issuedOn', label: 'Issued', type: 'date', required: true, half: true },
  { name: 'expiresOn', label: 'Expires', type: 'date', hint: 'Empty for never.' },
]

const recurringSpecs: FieldSpec[] = [
  ...headSpecs,
  { name: 'frequency', label: 'Repeats', type: 'select', options: [{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'yearly', label: 'Yearly' }], half: true },
  { name: 'interval', label: 'Every how many', type: 'whole', required: true, hint: '2 with "Monthly" is every second month.', half: true },
  { name: 'startsOn', label: 'First', type: 'date', required: true, half: true },
  { name: 'endsOn', label: 'Until', type: 'date', hint: 'Empty for no end.', half: true },
  ...termFields,
  { name: 'sendAutomatically', label: "Send it to the client's contacts by itself; otherwise it is left as a draft", type: 'check' },
]

interface EditorPageProps {
  title: string
  back: { to: string; label: string }
  /** Where what is edited comes from; null for something new. */
  route: string | null
}

/** A new document begins with its client. */
function useEditor<T extends { client: { id: number } }>({ route }: Pick<EditorPageProps, 'route'>) {
  const [query, setQuery] = useSearchParams()
  const options = useLoad<DocumentOptions>('documents/options')
  const existing = useLoad<T>(route ?? 'documents/options')
  const document = route === null ? undefined : existing.data
  const wanted = document ? document.client.id : Number(query.get('client'))
  const client = options.data?.clients.find(({ id }) => id === wanted)
  return { options, existing, document, client, choose: (id: string | null) => setQuery(id === null ? {} : { client: id }, { replace: true }) }
}

interface FrameProps extends EditorPageProps {
  editor: ReturnType<typeof useEditor>
  children: (client: DocumentClient, options: DocumentOptions) => React.ReactNode
}

function Frame({ title, back, route, editor, children }: FrameProps) {
  const { options, existing, document, client, choose } = editor
  const failed = options.status === 'error' ? options : route !== null && existing.status === 'error' ? existing : null
  const loading = options.status === 'loading' || (route !== null && existing.status === 'loading')
  return (
    <Page
      title={title}
      description={client?.name}
      actions={
        <LinkButton to={back.to} icon="chevronLeft">
          {back.label}
        </LinkButton>
      }
    >
      {failed && <ErrorState size="page" headingLevel={2} message={failed.error === 'Not found' ? 'There is nothing here.' : failed.error} onRetry={failed.reload} />}
      {!failed && loading && <LoadingState size="page" look="skeleton" label="Loading" />}
      {!failed && options.data && route === null && (
        <div className="client-choice">
          <Combobox
            label="Client"
            required
            placeholder="Search clients"
            value={client ? String(client.id) : null}
            options={options.data.clients.map(({ id, name, currency }) => ({ value: String(id), label: name, group: currency }))}
            onChange={choose}
          />
        </div>
      )}
      {!failed && options.data && document && !client && <EmptyState icon="warning" headingLevel={2} title="The client is archived" description="Restore the client to change this." />}
      {!failed && options.data && client && (route === null || document) && children(client, options.data)}
    </Page>
  )
}

const terms = (client: DocumentClient, notes: string) => ({
  discountPercent: client.discountPercent, tax1Name: client.tax1Name, tax1Percent: client.tax1Percent, tax2Name: client.tax2Name, tax2Percent: client.tax2Percent, notes,
  paymentTerms: client.paymentTerms, paymentTermDays: client.paymentTermDays,
})

/** Optional names come as empty text, and are stored as nothing. */
const clean = (values: Record<string, unknown>) => ({ ...values, tax1Name: values.tax1Name || null, tax2Name: values.tax2Name || null })

export function InvoiceEditPage() {
  const { id } = useParams()
  const route = id === undefined ? null : `invoices/${encodeURIComponent(id)}`
  const editor = useEditor<InvoiceDetails>({ route })
  const navigate = useNavigate()
  const toast = useToast()
  const { document } = editor
  const back = document ? { to: `/invoices/${document.id}`, label: 'Invoice' } : { to: '/invoices', label: 'Invoices' }
  return (
    <Frame title={document ? `Edit invoice ${document.number}` : id === undefined ? 'New invoice' : 'Edit invoice'} back={back} route={route} editor={editor}>
      {(client, options) => (
        <DocumentEditor
          key={`${client.id} ${document?.version}`}
          client={client}
          options={options}
          fields={invoiceSpecs}
          lines={document?.lines ?? []}
          initial={document ? { ...document } : { ...terms(client, options.invoiceNotes), issuedOn: options.today, dueOn: addDays(options.today, client.paymentTermDays ?? 30) }}
          submitLabel={document ? 'Save invoice' : 'Create draft'}
          cancelTo={back.to}
          onReload={editor.existing.reload}
          onSubmit={async (values, lines) => {
            const body = { ...clean(values), dueOn: values.dueOn ?? document?.dueOn ?? values.issuedOn, clientId: client.id, lines }
            const { id: saved } = document
              ? await callApi<InvoiceDetails>('PUT', `invoices/${document.id}`, { ...body, version: document.version })
              : await callApi<{ id: number }>('POST', 'invoices/free', body)
            toast.success(document ? 'Invoice saved' : 'Draft created')
            navigate(`/invoices/${saved}`)
          }}
        />
      )}
    </Frame>
  )
}

export function EstimateEditPage() {
  const { id } = useParams()
  const route = id === undefined ? null : `estimates/${encodeURIComponent(id)}`
  const editor = useEditor<EstimateDetails>({ route })
  const navigate = useNavigate()
  const toast = useToast()
  const { document } = editor
  const back = document ? { to: `/estimates/${document.id}`, label: 'Estimate' } : { to: '/estimates', label: 'Estimates' }
  return (
    <Frame title={document ? `Edit estimate ${document.number}` : id === undefined ? 'New estimate' : 'Edit estimate'} back={back} route={route} editor={editor}>
      {(client, options) => (
        <DocumentEditor
          key={`${client.id} ${document?.version}`}
          client={client}
          options={options}
          fields={estimateSpecs}
          lines={document?.lines ?? []}
          initial={document ? { ...document } : { ...terms(client, options.estimateNotes), issuedOn: options.today, expiresOn: addDays(options.today, options.estimateValidDays) }}
          submitLabel={document ? 'Save estimate' : 'Create draft'}
          cancelTo={back.to}
          onReload={editor.existing.reload}
          onSubmit={async (values, lines) => {
            const body = { ...clean(values), clientId: client.id, lines }
            const { id: saved } = document
              ? await callApi<EstimateDetails>('PUT', `estimates/${document.id}`, { ...body, version: document.version })
              : await callApi<{ id: number }>('POST', 'estimates', body)
            toast.success(document ? 'Estimate saved' : 'Draft created')
            navigate(`/estimates/${saved}`)
          }}
        />
      )}
    </Frame>
  )
}

export function RecurringEditPage() {
  const { id } = useParams()
  const route = id === undefined ? null : `recurring/${encodeURIComponent(id)}`
  const editor = useEditor<RecurringDetails>({ route })
  const navigate = useNavigate()
  const toast = useToast()
  const { document } = editor
  const back = { to: '/invoices/recurring', label: 'Recurring invoices' }
  return (
    <Frame title={id === undefined ? 'New recurring invoice' : 'Edit recurring invoice'} back={back} route={route} editor={editor}>
      {(client, options) => (
        <DocumentEditor
          key={`${client.id} ${document?.version}`}
          client={client}
          options={options}
          fields={recurringSpecs}
          lines={document?.lines ?? []}
          initial={document ? { ...document } : { ...terms(client, options.invoiceNotes), frequency: 'monthly', interval: 1, startsOn: options.today }}
          submitLabel="Save recurring invoice"
          cancelTo={back.to}
          onReload={editor.existing.reload}
          onSubmit={async (values, lines) => {
            const body = { ...clean(values), clientId: client.id, lines }
            if (document) await callApi('PUT', `recurring/${document.id}`, { ...body, version: document.version })
            else await callApi('POST', 'recurring', body)
            toast.success('Recurring invoice saved')
            navigate('/invoices/recurring')
          }}
        />
      )}
    </Frame>
  )
}
