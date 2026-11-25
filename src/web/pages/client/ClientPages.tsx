import { type FormEvent, useState } from 'react'
import type { ClientEstimate, ClientInvoice } from '../../../shared/billing'
import { ApiError, callApi, errorMessage } from '../../api'
import { useAuth } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { Page } from '../../shell/Page'
import { Badge, Button, Card, ErrorState, formatDate, LoadingState, Notice, TextArea, TextField, useToast } from '../../ui'
import { saveFile } from '../../work/csv'
import { formatMoney } from '../../work/format'
import { PrintedDocument } from '../../work/PrintedDocument'
import { useLinkCheck } from '../auth/useLinkCheck'
import { useLinkToken } from '../auth/useLinkToken'
import '../../work/work.css'

/** While a link is being looked up, and when it does not work. */
function Opening({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  const { info } = useAuth()
  if (error instanceof ApiError && error.code === 'link_invalid') {
    return (
      <Page title="This link does not work">
        <Notice tone="warning">It may have been revoked or replaced. Ask {info?.company.name} for a new one. If you reloaded this page, open the link you were given again.</Notice>
      </Page>
    )
  }
  return (
    <Page title={title}>
      {error === null ? <LoadingState size="page" label="Opening" /> : <ErrorState size="page" headingLevel={2} message={errorMessage(error)} onRetry={onRetry} />}
    </Page>
  )
}

export function ClientInvoicePage() {
  const token = useLinkToken()
  const { data, error, retry } = useLinkCheck<ClientInvoice>('client/invoice', token, true)
  const [paid, setPaid] = useState<ClientInvoice | null>(null)
  if (!data) return <Opening title="Invoice" error={error} onRetry={retry} />
  return <InvoiceView key={token} token={token} invoice={paid ?? data} onPaid={setPaid} />
}

function InvoiceView({ token, invoice, onPaid }: { token: string; invoice: ClientInvoice; onPaid: (invoice: ClientInvoice) => void }) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const due = formatMoney(invoice.dueAmount, invoice.currency)
  const pay = async () => {
    setBusy(true)
    try {
      const answer = await callApi<{ redirect?: string; invoice?: ClientInvoice }>('POST', 'client/invoice/pay', { token })
      if (answer.redirect) window.location.assign(answer.redirect)
      if (answer.invoice) onPaid(answer.invoice)
    } catch (reason) {
      toast.error(errorMessage(reason))
    }
    setBusy(false)
  }
  const download = async (fileId: number) => {
    try {
      const { name, mediaType, content } = await callApi<{ name: string; mediaType: string; content: string }>('POST', 'client/invoice/file', { token, fileId })
      saveFile(name, Uint8Array.from(atob(content), (character) => character.charCodeAt(0)), mediaType)
    } catch (reason) {
      toast.error(errorMessage(reason))
    }
  }
  return (
    <Page
      title={`Invoice ${invoice.number}`}
      description={
        <span className="facts-line">
          {invoice.status === 'paid' ? <Badge tone="success">Paid</Badge> : invoice.late ? <Badge tone="danger">Late</Badge> : <Badge tone="info">{invoice.status === 'closed' ? 'Closed' : 'Open'}</Badge>}
          <span>from {invoice.company.name}</span>
        </span>
      }
      actions={
        <>
          <Button icon="printer" onClick={() => window.print()}>
            Print or PDF
          </Button>
          {invoice.online !== null && (
            <Button variant="primary" icon="dollar" loading={busy} loadingLabel="Paying" onClick={() => void pay()}>
              {invoice.online === 'simulated' ? `Pay ${due} (simulated)` : `Pay ${due}`}
            </Button>
          )}
        </>
      }
    >
      {invoice.online === 'simulated' && <Notice tone="warning" title="Payment is simulated">No card is asked for and no money moves. The invoice is only marked as paid.</Notice>}
      <PrintedDocument
        word="Invoice"
        document={invoice}
        facts={[{ label: 'Due', value: formatDate(invoice.dueOn) }]}
        sums={invoice.paidAmount === 0 ? [] : [{ label: 'Paid', amount: -invoice.paidAmount }, { label: 'Still due', amount: invoice.dueAmount, strong: true }]}
      />
      {invoice.attachments.length > 0 && (
        <Card title="Attachments">
          <div className="receipts">
            {invoice.attachments.map(({ id, name }) => (
              <Button key={id} size="small" onClick={() => void download(id)}>
                {name}
              </Button>
            ))}
          </div>
        </Card>
      )}
    </Page>
  )
}

export function ClientEstimatePage() {
  const token = useLinkToken()
  const { data, error, retry } = useLinkCheck<ClientEstimate>('client/estimate', token, true)
  const [answered, setAnswered] = useState<ClientEstimate | null>(null)
  if (!data) return <Opening title="Estimate" error={error} onRetry={retry} />
  const estimate = answered ?? data
  return (
    <Page
      title={`Estimate ${estimate.number}`}
      description={`from ${estimate.company.name}`}
      actions={
        <Button icon="printer" onClick={() => window.print()}>
          Print or PDF
        </Button>
      }
    >
      {estimate.answer && (
        <Notice tone={estimate.answer.answer === 'accepted' ? 'success' : 'info'} title={`This estimate was ${estimate.answer.answer}`}>
          {[estimate.answer.name, estimate.answer.comment].filter(Boolean).join(': ')}
        </Notice>
      )}
      {estimate.expired && <Notice tone="warning">This estimate has expired. Ask for a new one.</Notice>}
      <PrintedDocument word="Estimate" document={estimate} facts={estimate.expiresOn === null ? [] : [{ label: 'Valid until', value: formatDate(estimate.expiresOn) }]} />
      {estimate.status === 'sent' && !estimate.expired && <AnswerForm key={token} token={token} onAnswered={setAnswered} />}
    </Page>
  )
}

const fields = ['name', 'comment'] as const

function AnswerForm({ token, onAnswered }: { token: string; onAnswered: (estimate: ClientEstimate) => void }) {
  const form = useForm('answer', fields)
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [answer, setAnswer] = useState<'accepted' | 'declined'>('accepted')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(async () => onAnswered(await callApi<ClientEstimate>('POST', 'client/estimate/answer', { token, answer, name, comment })), {
      name: name.trim().length < 2 ? 'Enter your name.' : null,
    })
  }
  return (
    <Card title="Your answer">
      <form className="stack" noValidate onSubmit={submit}>
        <FormMessages form={form} />
        <TextField label="Your name" required autoComplete="name" value={name} onChange={setName} {...form.field('name')} />
        <TextArea label="Comment" rows={3} value={comment} onChange={setComment} {...form.field('comment')} />
        <div className="form-actions">
          <Button type="submit" onClick={() => setAnswer('declined')} loading={form.busy && answer === 'declined'} loadingLabel="Sending">
            Decline
          </Button>
          <Button type="submit" variant="primary" icon="check" onClick={() => setAnswer('accepted')} loading={form.busy && answer === 'accepted'} loadingLabel="Sending">
            Accept estimate
          </Button>
        </div>
      </form>
    </Card>
  )
}
