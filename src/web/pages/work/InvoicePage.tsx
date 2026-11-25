import { type FormEvent, useId, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { productName } from '../../../shared/product'
import type { InvoiceDetails } from '../../../shared/work'
import { callApi, errorMessage } from '../../api'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { BrandMark } from '../../shell/BrandMark'
import { Page } from '../../shell/Page'
import { Button, Card, ConfirmDialog, DatePicker, Dialog, ErrorState, formatDate, LinkButton, LoadingState, Notice, Select, TextField, todayOnDevice, useToast } from '../../ui'
import { formatHours, formatMoney, parseMoney } from '../../work/format'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'
import '../../work/work.css'

const methods = { check: 'Check', bank_transfer: 'Bank transfer', card: 'Card', cash: 'Cash', online: 'Online', retainer: 'From retainer', other: 'Other' } as const

export function InvoicePage() {
  const { id = '' } = useParams()
  return <InvoiceLoader key={id} id={id} />
}

function InvoiceLoader({ id }: { id: string }) {
  const { status, data, error, reload, setData } = useLoad<InvoiceDetails>(`invoices/${encodeURIComponent(id)}`)
  const [dialog, setDialog] = useState<'send' | 'pay' | 'delete' | null>(null)
  const toast = useToast()
  const navigate = useNavigate()
  const close = () => setDialog(null)
  return (
    <Page
      title={data ? `Invoice ${data.number}` : 'Invoice'}
      description={
        data && (
          <span className="facts-line">
            <InvoiceStatusBadge invoice={data} />
            <Link to={`/clients/${data.client.id}`}>{data.client.name}</Link>
            <span>Due {formatDate(data.dueOn)}</span>
          </span>
        )
      }
      actions={
        <>
          <LinkButton to="/invoices" icon="chevronLeft">
            Invoices
          </LinkButton>
          {data && (
            <Button icon="printer" onClick={() => window.print()}>
              Print or PDF
            </Button>
          )}
          {data?.status === 'draft' && (
            <>
              <Button icon="trash" onClick={() => setDialog('delete')}>
                Delete draft
              </Button>
              <Button variant="primary" icon="send" onClick={() => setDialog('send')}>
                Mark as sent
              </Button>
            </>
          )}
          {data?.canPay && (
            <Button variant="primary" icon="dollar" onClick={() => setDialog('pay')}>
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
          <Document invoice={data} />
          {data.payments.length > 0 && (
            <Card title="Payments">
              <ul className="payments">
                {data.payments.map(({ id: paymentId, paidOn, amount, method, reference, simulated }) => (
                  <li key={paymentId}>
                    <span>
                      <span className="strong">{formatMoney(amount, data.currency)}</span> <span className="muted">{[methods[method], reference].filter(Boolean).join(', ')}</span>
                      {simulated && <span className="muted"> (simulated, no real money)</span>}
                    </span>
                    <span className="muted">{formatDate(paidOn)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <ConfirmDialog
            open={dialog === 'send'}
            onClose={close}
            title="Mark as sent?"
            message={`The invoice becomes open and counts as outstanding. ${productName} does not send it: print it, or save it as PDF, and send it to the client yourself.`}
            confirmLabel="Mark as sent"
            onConfirm={async () => {
              try {
                setData(await callApi<InvoiceDetails>('POST', `invoices/${data.id}/send`, { version: data.version }))
                toast.success('Marked as sent')
              } catch (reason) {
                throw new Error(errorMessage(reason), { cause: reason })
              }
            }}
          />
          <ConfirmDialog
            open={dialog === 'delete'}
            onClose={close}
            title="Delete this draft?"
            message="Its hours and expenses can be invoiced again. The number is not used again."
            confirmLabel="Delete draft"
            destructive
            onConfirm={async () => {
              try {
                await callApi('POST', `invoices/${data.id}/delete`, { version: data.version })
                toast.success('Draft deleted')
                navigate('/invoices')
              } catch (reason) {
                throw new Error(errorMessage(reason), { cause: reason })
              }
            }}
          />
          {dialog === 'pay' && (
            <PaymentDialog
              invoice={data}
              onClose={close}
              onPaid={(invoice) => {
                setData(invoice)
                close()
                toast.success(invoice.status === 'paid' ? 'Paid in full' : 'Payment recorded')
              }}
            />
          )}
        </>
      )}
    </Page>
  )
}

const quantity = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })
const percent = (thousandths: number | null) => `${quantity.format((thousandths ?? 0) / 1000)}%`

function Document({ invoice }: { invoice: InvoiceDetails }) {
  const { currency, company, client } = invoice
  const money = (amount: number) => formatMoney(amount, currency)
  return (
    <article className="paper" aria-label={`Invoice ${invoice.number}`}>
      <header className="paper-head">
        <div className="paper-company">
          <BrandMark />
          <div>
            <p className="paper-name">{company.name}</p>
            <p className="lines muted">{company.address}</p>
          </div>
        </div>
        <div className="paper-title">
          <p className="paper-word">Invoice</p>
          <p className="figure">{invoice.number}</p>
        </div>
      </header>
      <div className="paper-facts">
        <div>
          <p className="paper-label">Billed to</p>
          <p className="strong">{client.name}</p>
          <p className="lines">{invoice.clientAddress}</p>
        </div>
        <dl>
          <dt>Issued</dt>
          <dd>{formatDate(invoice.issuedOn)}</dd>
          <dt>Due</dt>
          <dd>{formatDate(invoice.dueOn)}</dd>
          {invoice.purchaseOrder && (
            <>
              <dt>Purchase order</dt>
              <dd>{invoice.purchaseOrder}</dd>
            </>
          )}
          {invoice.subject && (
            <>
              <dt>Subject</dt>
              <dd>{invoice.subject}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Lines">
        <table className="paper-lines">
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col">Quantity</th>
              <th scope="col">Price</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td>{line.minutes === null ? quantity.format(line.quantity / 1000) : `${formatHours(line.minutes)} h`}</td>
                <td>{money(line.unitPrice)}</td>
                <td>{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="paper-foot">
        <p className="lines muted">{invoice.notes}</p>
        <dl className="sum">
          <dt>Subtotal</dt>
          <dd>{money(invoice.subtotal)}</dd>
          {invoice.discountAmount !== 0 && (
            <>
              <dt>Discount ({percent(invoice.discountPercent)})</dt>
              <dd>{money(-invoice.discountAmount)}</dd>
            </>
          )}
          {invoice.tax1Amount !== 0 && (
            <>
              <dt>
                {invoice.tax1Name} ({percent(invoice.tax1Percent)})
              </dt>
              <dd>{money(invoice.tax1Amount)}</dd>
            </>
          )}
          {invoice.tax2Amount !== 0 && (
            <>
              <dt>
                {invoice.tax2Name} ({percent(invoice.tax2Percent)})
              </dt>
              <dd>{money(invoice.tax2Amount)}</dd>
            </>
          )}
          <dt className="sum-total">Total</dt>
          <dd className="sum-total">{money(invoice.total)}</dd>
          {invoice.paidAmount !== 0 && (
            <>
              <dt>Paid</dt>
              <dd>{money(-invoice.paidAmount)}</dd>
              <dt className="sum-total">{invoice.status === 'closed' ? 'Not collected' : 'Still due'}</dt>
              <dd className="sum-total">{money(invoice.dueAmount)}</dd>
            </>
          )}
        </dl>
      </div>
    </article>
  )
}

const fields = ['amount', 'paidOn', 'method', 'reference'] as const

function PaymentDialog({ invoice, onClose, onPaid }: { invoice: InvoiceDetails; onClose: () => void; onPaid: (invoice: InvoiceDetails) => void }) {
  const formId = useId()
  const form = useForm('payment', fields)
  const [amount, setAmount] = useState(formatMoney(invoice.dueAmount, invoice.currency).replace(/[^\d.]/g, ''))
  const [paidOn, setPaidOn] = useState(todayOnDevice())
  const [method, setMethod] = useState('check')
  const [reference, setReference] = useState('')
  const parsed = parseMoney(amount, invoice.currency)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => onPaid(await callApi<InvoiceDetails>('POST', `invoices/${invoice.id}/payments`, { amount: parsed, paidOn, method, reference })),
      {
        amount: parsed === null || parsed === 0 ? 'Enter an amount.' : parsed > invoice.dueAmount ? `At most ${formatMoney(invoice.dueAmount, invoice.currency)} is due.` : null,
        paidOn: paidOn === '' ? 'Enter a date.' : null,
      },
    )
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Record payment"
      closeOnOutsidePress={false}
      busy={form.busy}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={form.busy} loadingLabel="Recording the payment">
            Record payment
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" noValidate onSubmit={submit}>
        <FormMessages form={form} />
        <Notice>For money you have already received. Nothing is charged here.</Notice>
        <div className="form-pair">
          <TextField label={`Amount (${invoice.currency})`} required inputMode="decimal" value={amount} onChange={setAmount} {...form.field('amount')} />
          <DatePicker label="Received" required value={paidOn} onChange={setPaidOn} {...form.field('paidOn')} />
        </div>
        <div className="form-pair">
          <Select
            label="Method"
            value={method}
            options={(['check', 'bank_transfer', 'card', 'cash', 'other'] as const).map((value) => ({ value, label: methods[value] }))}
            onChange={setMethod}
            {...form.field('method')}
          />
          <TextField label="Reference" placeholder="Check 1042" value={reference} onChange={setReference} {...form.field('reference')} />
        </div>
      </form>
    </Dialog>
  )
}
