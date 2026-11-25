import { Link, useParams } from 'react-router-dom'
import type { Statement } from '../../../shared/billing'
import { useLoad } from '../../auth/useLoad'
import { apiUrl } from '../../basePath'
import { Page } from '../../shell/Page'
import { Button, ErrorState, formatDate, LinkButton, LoadingState } from '../../ui'
import { methodLabels } from '../../work/billing'
import { formatMoney } from '../../work/format'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'
import '../../work/work.css'

const ages = ['Not yet due', 'Up to 30 days late', '31 to 60 days', '61 to 90 days', 'Over 90 days']

/** What a client owes, to print. */
export function StatementPage() {
  const { id = '' } = useParams()
  const { status, data, error, reload } = useLoad<Statement>(`clients/${encodeURIComponent(id)}/statement`)
  return (
    <Page
      title="Statement"
      description={data?.client.name}
      actions={
        <>
          <LinkButton to={`/clients/${id}`} icon="chevronLeft">
            Client
          </LinkButton>
          <Button icon="printer" onClick={() => window.print()}>
            Print or PDF
          </Button>
        </>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the statement" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error === 'Not found' ? 'There is no such client.' : error} onRetry={reload} />}
      {data && <Sheet statement={data} />}
    </Page>
  )
}

function Sheet({ statement: { client, company, today, invoices, payments, ageing, retainers } }: { statement: Statement }) {
  const money = (amount: number) => formatMoney(amount, client.currency)
  return (
    <article className="paper" aria-label="Statement">
      <header className="paper-head">
        <div className="paper-company">
          {company.logo && <img className="paper-logo" src={apiUrl('logo')} alt="" />}
          <div>
            <p className="paper-name">{company.name}</p>
            <p className="lines muted">{company.address}</p>
          </div>
        </div>
        <div className="paper-title">
          <p className="paper-word">Statement</p>
          <p>{formatDate(today)}</p>
        </div>
      </header>
      <div className="paper-facts">
        <div>
          <p className="paper-label">For</p>
          <p className="strong">{client.name}</p>
          <p className="lines">{client.address}</p>
        </div>
        <dl>
          {ages.map((label, index) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd>{money(ageing[index] ?? 0)}</dd>
            </div>
          ))}
          {retainers.map(({ id, name, balance }) => (
            <div key={id} className="contents">
              <dt>Retainer {name}</dt>
              <dd>{money(balance)}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Open invoices">
        <table className="paper-lines">
          <thead>
            <tr>
              <th scope="col">Open invoice</th>
              <th scope="col">Issued</th>
              <th scope="col">Due</th>
              <th scope="col">Total</th>
              <th scope="col">Still due</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={5}>Nothing is open.</td>
              </tr>
            )}
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>
                  <Link to={`/invoices/${invoice.id}`}>{invoice.number}</Link> {invoice.subject} {invoice.late && <InvoiceStatusBadge invoice={invoice} />}
                </td>
                <td>{formatDate(invoice.issuedOn)}</td>
                <td>{formatDate(invoice.dueOn)}</td>
                <td>{money(invoice.total)}</td>
                <td>{money(invoice.dueAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="paper-foot">
        <dl className="sum">
          <dt className="sum-total">Total due</dt>
          <dd className="sum-total">{money(invoices.reduce((sum, { dueAmount }) => sum + dueAmount, 0))}</dd>
        </dl>
      </div>
      {payments.length > 0 && (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Payments">
          <table className="paper-lines">
            <thead>
              <tr>
                <th scope="col">Payments in the last three months</th>
                <th scope="col">Date</th>
                <th scope="col">Method</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(({ invoice, paidOn, amount, method }, index) => (
                <tr key={index}>
                  <td>{invoice}</td>
                  <td>{formatDate(paidOn)}</td>
                  <td>{methodLabels[method]}</td>
                  <td>{money(amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}
