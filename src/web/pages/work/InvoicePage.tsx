import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { InvoiceDetails, MessageInput, PaymentRow } from '../../../shared/billing'
import { productName } from '../../../shared/product'
import { callApi, errorMessage } from '../../api'
import { useAuth } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { apiUrl } from '../../basePath'
import { Page } from '../../shell/Page'
import { Button, Card, ErrorState, formatDate, IconButton, LinkButton, LoadingState, Menu, Notice, todayOnDevice, useToast } from '../../ui'
import { methodLabels } from '../../work/billing'
import { FileButton } from '../../work/FileButton'
import { FormDialog } from '../../work/FormDialog'
import { formatMoney } from '../../work/format'
import { LinkDialog } from '../../work/LinkDialog'
import { MessageDialog } from '../../work/MessageDialog'
import { MessageHistory } from '../../work/MessageHistory'
import { PrintedDocument } from '../../work/PrintedDocument'
import { useActions } from '../../work/useActions'
import { AddUnbilledDialog } from './AddUnbilledDialog'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'
import '../../work/work.css'

export function InvoicePage() {
  const { id = '' } = useParams()
  return <InvoiceLoader key={id} id={id} />
}

type Open = 'pay' | 'retainer' | 'write-off' | 'note' | 'add' | Exclude<MessageInput['kind'], 'note'> | { refund: PaymentRow } | { link: string } | null

const messageTitles = { sent: 'Send invoice', reminder: 'Send a reminder', thank_you: 'Say thank you' } as const

function InvoiceLoader({ id }: { id: string }) {
  const { status, data, error, reload, setData } = useLoad<InvoiceDetails>(`invoices/${encodeURIComponent(id)}`)
  const { info } = useAuth()
  const [open, setOpen] = useState<Open>(null)
  const { ask, run, dialog } = useActions()
  const toast = useToast()
  const navigate = useNavigate()
  const close = () => setOpen(null)
  const done = (message: string) => (next: InvoiceDetails) => {
    setData(next)
    close()
    toast.success(message)
  }
  const route = `invoices/${id}`
  const post = async (path: string, body: object, message: string) => done(message)(await callApi<InvoiceDetails>('POST', `${route}/${path}`, body))
  const version = data?.version

  const menu = data
    ? [
        ...(data.status === 'draft'
          ? [{ id: 'mark', label: 'Mark as sent', onSelect: () => ask({ title: 'Mark as sent?', message: `The invoice becomes open and counts as outstanding. ${productName} sends nothing: send it to the client yourself.`, confirmLabel: 'Mark as sent', route: `${route}/send`, body: { version }, done: 'Marked as sent', then: setData }) }]
          : []),
        ...(data.status === 'draft' || data.status === 'open' ? [{ id: 'add', label: 'Add time and expenses', onSelect: () => setOpen('add') }] : []),
        ...(data.status === 'open' ? [{ id: 'reminder', label: 'Send a reminder', onSelect: () => setOpen('reminder') }] : []),
        ...(data.status === 'open' || data.status === 'paid' ? [{ id: 'resend', label: 'Send again', onSelect: () => setOpen('sent') }] : []),
        ...(data.payments.length > 0 ? [{ id: 'thanks', label: 'Say thank you', onSelect: () => setOpen('thank_you') }] : []),
        ...(data.status !== 'draft'
          ? [
              {
                id: 'link',
                label: 'Make a client link',
                onSelect: () => {
                  callApi<{ link: string }>('POST', `${route}/link`).then(setOpen, (reason: unknown) => toast.error(errorMessage(reason)))
                },
              },
            ]
          : []),
        { id: 'note', label: 'Add a note', onSelect: () => setOpen('note') },
        { id: 'duplicate', label: 'Duplicate', onSelect: () => void run('POST', `${route}/duplicate`, undefined, 'Draft created', ({ id: copy }: { id: number }) => navigate(`/invoices/${copy}`)) },
        ...(data.status === 'open' && data.payments.length === 0
          ? [{ id: 'draft', label: 'Make it a draft again', onSelect: () => ask({ title: 'Make it a draft again?', message: 'The links sent to the client stop working.', confirmLabel: 'Make it a draft', route: `${route}/draft`, body: { version }, done: 'It is a draft again', then: setData }) }]
          : []),
        ...(data.status === 'open' && data.canManagePayments ? [{ id: 'write-off', label: 'Write off', onSelect: () => setOpen('write-off') }] : []),
        ...(data.status === 'closed' && data.canManagePayments ? [{ id: 'reopen', label: 'Reopen', onSelect: () => void run('POST', `${route}/reopen`, { version }, 'Invoice reopened', setData) }] : []),
        ...(data.payments.length === 0 && data.status !== 'closed'
          ? [
              {
                id: 'delete', label: 'Delete', destructive: true,
                onSelect: () =>
                  ask({
                    title: `Delete invoice ${data.number}?`, message: 'Its hours and expenses can be invoiced again. The number is not used again.', confirmLabel: 'Delete invoice', destructive: true,
                    route: `${route}/delete`, body: { version }, done: 'Invoice deleted', then: () => navigate('/invoices'),
                  }),
              },
            ]
          : []),
      ]
    : []

  return (
    <Page
      title={data ? `Invoice ${data.number}` : 'Invoice'}
      description={
        data && (
          <span className="facts-line">
            <InvoiceStatusBadge invoice={data} />
            <Link to={`/clients/${data.client.id}`}>{data.client.name}</Link>
            <span>Due {formatDate(data.dueOn)}</span>
            {data.recurring && <span>Recurring</span>}
          </span>
        )
      }
      actions={
        <>
          <LinkButton to="/invoices" icon="chevronLeft">
            Invoices
          </LinkButton>
          {data && (
            <>
              <Button icon="printer" onClick={() => window.print()}>
                Print or PDF
              </Button>
              <Menu label="More" align="end" items={menu} />
              {(data.status === 'draft' || data.status === 'open') && (
                <LinkButton to={`/invoices/${data.id}/edit`} icon="edit">
                  Edit
                </LinkButton>
              )}
            </>
          )}
          {data?.status === 'draft' && (
            <Button variant="primary" icon="send" onClick={() => setOpen('sent')}>
              Send
            </Button>
          )}
          {data?.canPay && (
            <Button variant="primary" icon="dollar" onClick={() => setOpen('pay')}>
              Record payment
            </Button>
          )}
        </>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the invoice" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error === 'Not found' ? 'There is no such invoice.' : error} onRetry={reload} />}
      {data && (
        <>
          {data.writeOff && (
            <Notice tone="warning" title={`${formatMoney(data.writeOff.amount, data.currency)} was written off on ${formatDate(data.writeOff.on)}`}>
              {data.writeOff.reason || 'No reason was given.'}
            </Notice>
          )}
          <PrintedDocument
            word="Invoice"
            document={data}
            facts={[{ label: 'Due', value: formatDate(data.dueOn) }]}
            sums={
              data.paidAmount === 0 && data.status !== 'closed'
                ? []
                : [
                    { label: 'Paid', amount: -data.paidAmount },
                    { label: data.status === 'closed' ? 'Not collected' : 'Still due', amount: data.dueAmount, strong: true },
                  ]
            }
          />
          <Payments invoice={data} onRetainer={() => setOpen('retainer')} onRefund={(refund) => setOpen({ refund })} onRemove={(payment) =>
            ask({
              title: 'Take this payment back?',
              message: `${formatMoney(payment.amount, data.currency)} of ${formatDate(payment.paidOn)} is removed, as if it was never recorded.${payment.method === 'retainer' ? ' The money goes back to the retainer.' : ''}`,
              confirmLabel: 'Take back', destructive: true, route: `${route}/remove-payment`, body: { paymentId: payment.id }, done: 'Payment taken back', then: setData,
            })}
          />
          <Attachments invoice={data} onChange={setData} />
          {data.links.length > 0 && (
            <Card
              title="Client links"
              actions={
                <Button size="small" onClick={() => ask({ title: 'Revoke all links?', message: 'Clients can no longer open the invoice with them.', confirmLabel: 'Revoke all', destructive: true, route: `${route}/revoke-links`, done: 'Links revoked', then: setData })}>
                  Revoke all
                </Button>
              }
            >
              <p className="muted">
                {data.links.length === 1 ? '1 link works' : `${data.links.length} links work`}.{' '}
                {data.links.some(({ lastViewedAt }) => lastViewedAt !== null) ? `Last opened ${formatDate(data.links.map(({ lastViewedAt }) => lastViewedAt ?? '').sort().at(-1)?.slice(0, 10) ?? '')}.` : 'Not opened yet.'}
              </p>
            </Card>
          )}
          <MessageHistory messages={data.messages} />
        </>
      )}
      {data && open === 'pay' && (
        <FormDialog
          title="Record payment"
          submitLabel="Record payment"
          intro={<Notice>For money you have already received. Nothing is charged here.</Notice>}
          initial={{ amount: data.dueAmount, paidOn: todayOnDevice(), method: 'check' }}
          fields={[
            { name: 'amount', label: 'Amount', type: 'money', currency: data.currency, required: true, half: true },
            { name: 'paidOn', label: 'Received', type: 'date', required: true, half: true },
            { name: 'method', label: 'Method', type: 'select', half: true, options: (['check', 'bank_transfer', 'card', 'cash', 'other'] as const).map((value) => ({ value, label: methodLabels[value] })) },
            { name: 'reference', label: 'Reference', type: 'text', placeholder: 'Check 1042', half: true },
            { name: 'notes', label: 'Notes', type: 'area', rows: 2 },
          ]}
          onClose={close}
          onSubmit={async (values) => {
            const next = await callApi<InvoiceDetails>('POST', `${route}/payments`, values)
            done(next.status === 'paid' ? 'Paid in full' : 'Payment recorded')(next)
          }}
        />
      )}
      {data && open === 'retainer' && (
        <FormDialog
          title="Pay from a retainer"
          submitLabel="Pay"
          initial={{ retainerId: data.retainers[0]?.id, amount: Math.min(data.dueAmount, data.retainers[0]?.balance ?? 0) }}
          fields={[
            { name: 'retainerId', label: 'Retainer', type: 'id', required: true, options: data.retainers.map(({ id: value, name, balance }) => ({ value: String(value), label: `${name}, ${formatMoney(balance, data.currency)} left` })) },
            { name: 'amount', label: 'Amount', type: 'money', currency: data.currency, required: true },
          ]}
          onClose={close}
          onSubmit={(values) => post('pay-from-retainer', values, 'Paid from the retainer')}
        />
      )}
      {data && open === 'write-off' && (
        <FormDialog
          title={`Write off ${formatMoney(data.dueAmount, data.currency)}?`}
          submitLabel="Write off"
          intro={<p className="muted">The invoice is closed, and what is due no longer counts as outstanding. It can be reopened.</p>}
          fields={[{ name: 'reason', label: 'Reason', type: 'area', rows: 2 }]}
          onClose={close}
          onReload={reload}
          onSubmit={(values) => post('write-off', { ...values, version: data.version }, 'Written off')}
        />
      )}
      {data && open === 'note' && (
        <FormDialog
          title="Add a note"
          submitLabel="Add note"
          intro={<p className="muted">Only your company sees it.</p>}
          fields={[{ name: 'body', label: 'Note', type: 'area', required: true }]}
          onClose={close}
          onReload={reload}
          onSubmit={(values) => post('messages', { ...values, kind: 'note', recipients: [], subject: '', version: data.version }, 'Note added')}
        />
      )}
      {data && open === 'add' && <AddUnbilledDialog invoice={data} onClose={close} onAdded={done('Added')} />}
      {data && (open === 'sent' || open === 'reminder' || open === 'thank_you') && (
        <MessageDialog
          title={messageTitles[open]}
          submitLabel="Send"
          kind={open}
          route={`${route}/message?kind=${open}`}
          contacts={data.contacts}
          onClose={close}
          onSend={(message) => post('messages', { ...message, version: data.version }, info?.emailDelivers ? 'Sent' : 'Kept in the Outbox')}
        />
      )}
      {data && open !== null && typeof open === 'object' && 'refund' in open && (
        <FormDialog
          title="Record a refund"
          submitLabel="Record refund"
          intro={<Notice>For money you have already given back. Nothing is paid from here.</Notice>}
          initial={{ amount: open.refund.amount - open.refund.refunds.reduce((sum, { amount }) => sum + amount, 0), refundedOn: todayOnDevice() }}
          fields={[
            { name: 'amount', label: 'Amount', type: 'money', currency: data.currency, required: true, half: true },
            { name: 'refundedOn', label: 'Given back', type: 'date', required: true, half: true },
            { name: 'reason', label: 'Reason', type: 'area', rows: 2 },
          ]}
          onClose={close}
          onSubmit={(values) => post('refund', { ...values, paymentId: open.refund.id }, 'Refund recorded')}
        />
      )}
      {open !== null && typeof open === 'object' && 'link' in open && (
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

interface PaymentsProps {
  invoice: InvoiceDetails
  onRetainer: () => void
  onRefund: (payment: PaymentRow) => void
  onRemove: (payment: PaymentRow) => void
}

function Payments({ invoice, onRetainer, onRefund, onRemove }: PaymentsProps) {
  const { payments, currency, canManagePayments, canPay, retainers, status } = invoice
  if (payments.length === 0 && (!canPay || retainers.length === 0)) return null
  return (
    <Card
      title="Payments"
      actions={
        canPay && retainers.length > 0 ? (
          <Button size="small" onClick={onRetainer}>
            Pay from a retainer
          </Button>
        ) : undefined
      }
    >
      {payments.length === 0 && <p className="muted">Nothing was paid yet.</p>}
      <ul className="payments">
        {payments.map((payment) => {
          const refunded = payment.refunds.reduce((sum, { amount }) => sum + amount, 0)
          const what = `payment of ${formatMoney(payment.amount, currency)}, ${formatDate(payment.paidOn)}`
          return (
            <li key={payment.id}>
              <span className="cell-two">
                <span>
                  <span className="strong">{formatMoney(payment.amount, currency)}</span> <span className="muted">{[methodLabels[payment.method], payment.reference].filter(Boolean).join(', ')}</span>
                  {payment.simulated && <span className="muted"> (simulated, no real money)</span>}
                </span>
                {payment.notes && <span className="cell-sub">{payment.notes}</span>}
                {payment.refunds.map(({ id, amount, refundedOn, reason }) => (
                  <span key={id} className="cell-sub">
                    {formatMoney(amount, currency)} given back on {formatDate(refundedOn)}
                    {reason && `, ${reason}`}
                  </span>
                ))}
              </span>
              <span className="payment-end">
                <span className="muted">{formatDate(payment.paidOn)}</span>
                {canManagePayments && status !== 'closed' && (
                  <Menu
                    label={`Actions for the ${what}`}
                    icon="more"
                    iconOnly
                    size="small"
                    align="end"
                    items={[
                      ...(payment.method !== 'retainer' && refunded < payment.amount ? [{ id: 'refund', label: 'Record a refund', onSelect: () => onRefund(payment) }] : []),
                      ...(payment.method !== 'online' || payment.simulated ? [{ id: 'remove', label: 'Take back', destructive: true, onSelect: () => onRemove(payment) }] : []),
                    ]}
                  />
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

const mostBytes = 5 * 1024 * 1024

function Attachments({ invoice, onChange }: { invoice: InvoiceDetails; onChange: (invoice: InvoiceDetails) => void }) {
  const { run } = useActions()
  const toast = useToast()
  const route = `invoices/${invoice.id}`
  return (
    <Card title="Attachments">
      <div className="receipts">
        {invoice.attachments.length === 0 && <span className="muted">Nothing is attached.</span>}
        {invoice.attachments.map(({ id, name }) => (
          <span key={id} className="badges">
            <a href={apiUrl(`${route}/attachments/${id}`)}>{name}</a>
            <IconButton icon="close" size="small" variant="quiet" label={`Remove ${name}`} onClick={() => void run('POST', `${route}/detach`, { fileId: id }, 'Removed', onChange)} />
          </span>
        ))}
        {invoice.receipts > 0 && (
          <Button size="small" onClick={() => void run('POST', `${route}/attach-receipts`, undefined, 'Receipts attached', onChange)}>
            Attach {invoice.receipts === 1 ? 'the receipt' : `${invoice.receipts} receipts`} of its expenses
          </Button>
        )}
        <FileButton
          accept="image/png,image/jpeg,application/pdf"
          icon="plus"
          label="Attach a file"
          onChoose={(file) => {
            if (file.size > mostBytes) toast.error('A file can have 5 MB at most.')
            else void run('PUT', `${route}/attachments?name=${encodeURIComponent(file.name)}`, file, 'Attached', onChange)
          }}
        />
      </div>
    </Card>
  )
}
