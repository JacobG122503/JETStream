import type { ReactNode } from 'react'
import type { PrintedDocument as Printed } from '../../shared/billing'
import { apiUrl } from '../basePath'
import { formatDate } from '../ui'
import { formatHours, formatMoney } from './format'

const quantity = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })
const percent = (thousandths: number | null) => `${quantity.format((thousandths ?? 0) / 1000)}%`

interface PrintedDocumentProps {
  word: 'Invoice' | 'Estimate'
  document: Printed
  /** Below "Issued". */
  facts: { label: string; value: ReactNode }[]
  /** Below the total. */
  sums?: { label: string; amount: number; strong?: boolean }[]
}

/** An invoice or estimate as it is printed, and as the client sees it. */
export function PrintedDocument({ word, document, facts, sums = [] }: PrintedDocumentProps) {
  const { currency, company } = document
  const money = (amount: number) => formatMoney(amount, currency)
  const shown = [
    { label: 'Issued', value: formatDate(document.issuedOn) }, ...facts,
    ...(document.purchaseOrder ? [{ label: 'Purchase order', value: document.purchaseOrder }] : []),
    ...(document.subject ? [{ label: 'Subject', value: document.subject }] : []),
  ]
  return (
    <article className="paper" aria-label={`${word} ${document.number}`}>
      <header className="paper-head">
        <div className="paper-company">
          {company.logo && <img className="paper-logo" src={apiUrl('logo')} alt="" />}
          <div>
            <p className="paper-name">{company.name}</p>
            <p className="lines muted">{company.address}</p>
          </div>
        </div>
        <div className="paper-title">
          <p className="paper-word">{word}</p>
          <p className="figure">{document.number}</p>
        </div>
      </header>
      <div className="paper-facts">
        <div>
          <p className="paper-label">{word === 'Invoice' ? 'Billed to' : 'For'}</p>
          <p className="strong">{document.clientName}</p>
          <p className="lines">{document.clientAddress}</p>
        </div>
        <dl>
          {shown.map(({ label, value }) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
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
            {document.lines.map((line) => (
              <tr key={line.id}>
                <td className="lines">{line.description}</td>
                <td>{line.minutes === null ? quantity.format(line.quantity / 1000) : formatHours(line.minutes)}</td>
                <td>{money(line.unitPrice)}</td>
                <td>{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="paper-foot">
        <p className="lines muted">{document.notes}</p>
        <dl className="sum">
          <dt>Subtotal</dt>
          <dd>{money(document.subtotal)}</dd>
          {document.discountAmount !== 0 && (
            <>
              <dt>Discount ({percent(document.discountPercent)})</dt>
              <dd>{money(-document.discountAmount)}</dd>
            </>
          )}
          {document.tax1Amount !== 0 && (
            <>
              <dt>
                {document.tax1Name} ({percent(document.tax1Percent)})
              </dt>
              <dd>{money(document.tax1Amount)}</dd>
            </>
          )}
          {document.tax2Amount !== 0 && (
            <>
              <dt>
                {document.tax2Name} ({percent(document.tax2Percent)})
              </dt>
              <dd>{money(document.tax2Amount)}</dd>
            </>
          )}
          <dt className="sum-total">Total</dt>
          <dd className="sum-total">{money(document.total)}</dd>
          {sums.map(({ label, amount, strong }) => (
            <div key={label} className="contents">
              <dt className={strong ? 'sum-total' : undefined}>{label}</dt>
              <dd className={strong ? 'sum-total' : undefined}>{money(amount)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  )
}
