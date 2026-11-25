import { type FormEvent, useState } from 'react'
import type { DocumentClient, DocumentLineRow, DocumentOptions, LineInput } from '../../shared/billing'
import { documentTotals } from '../../shared/calc'
import { FormMessages } from '../auth/FormMessages'
import { Button, Card, Checkbox, IconButton, LinkButton, Select, TextArea, TextField } from '../ui'
import { Fields, type FieldSpec, useFields } from './FormDialog'
import { formatHours, formatMoney, moneyInput, parseMoney } from './format'

interface EditedLine {
  key: number
  id: number | null
  /** Hours and expenses keep their quantity and price. */
  fixed: boolean
  minutes: number | null
  description: string
  quantity: string
  price: string
  projectId: string
  categoryId: string
  tax1: boolean
  tax2: boolean
  /** As stored, for fixed lines. */
  stored: { quantity: number; unitPrice: number }
}

const parseQuantity = (text: string): number | null => (/^-?\d{1,6}(\.\d{1,3})?$/.test(text.trim()) ? Math.round(Number(text) * 1000) : null)

function parsePrice(text: string, currency: string): number | null {
  const clean = text.trim()
  if (!clean.startsWith('-')) return parseMoney(clean, currency)
  const amount = parseMoney(clean.slice(1), currency)
  return amount === null ? null : -amount
}

interface DocumentEditorProps {
  client: DocumentClient
  options: DocumentOptions
  /** Above the lines; what is in `terms` is below them. */
  fields: FieldSpec[]
  initial: Record<string, unknown>
  lines: DocumentLineRow[]
  submitLabel: string
  cancelTo: string
  onReload?: () => void
  onSubmit: (values: Record<string, unknown>, lines: LineInput[]) => Promise<void>
}

const taxSpecs: FieldSpec[] = [
  { name: 'discountPercent', label: 'Discount, percent', type: 'percent' },
  { name: 'tax1Name', label: 'Tax', type: 'text', half: true },
  { name: 'tax1Percent', label: 'Tax, percent', type: 'percent', half: true },
  { name: 'tax2Name', label: 'Second tax', type: 'text', half: true },
  { name: 'tax2Percent', label: 'Second tax, percent', type: 'percent', half: true },
  { name: 'notes', label: 'Notes on the document', type: 'area' },
]

let lastKey = 0

/** Where invoices, estimates and recurring invoices are written. */
export function DocumentEditor({ client, options, fields, initial, lines: initialLines, submitLabel, cancelTo, onReload, onSubmit }: DocumentEditorProps) {
  const { currency } = client
  const specs = [...fields, ...taxSpecs]
  const { form, values, setValues, submit } = useFields('document', specs, initial)
  const blank = (): EditedLine => ({
    key: ++lastKey, id: null, fixed: false, minutes: null, description: '', quantity: '1', price: '', projectId: '', categoryId: '', tax1: client.tax1Percent !== null,
    tax2: client.tax2Percent !== null, stored: { quantity: 0, unitPrice: 0 },
  })
  const [lines, setLines] = useState<EditedLine[]>(() =>
    initialLines.length === 0
      ? [blank()]
      : initialLines.map((line) => ({
          key: ++lastKey, id: line.id, fixed: line.kind === 'time' || line.kind === 'expense', minutes: line.minutes, description: line.description,
          quantity: String(line.quantity / 1000), price: moneyInput(line.unitPrice, currency), projectId: line.projectId === null ? '' : String(line.projectId),
          categoryId: line.categoryId === null ? '' : String(line.categoryId), tax1: line.tax1, tax2: line.tax2, stored: { quantity: line.quantity, unitPrice: line.unitPrice },
        })),
  )
  const change = (key: number, next: Partial<EditedLine>) => setLines((before) => before.map((line) => (line.key === key ? { ...line, ...next } : line)))
  const numbers = (line: EditedLine) => (line.fixed ? line.stored : { quantity: parseQuantity(line.quantity), unitPrice: parsePrice(line.price, currency) })
  const rate = (name: string) => {
    const text = values[name]
    return typeof text === 'string' && /^\d{1,3}(\.\d{1,3})?$/.test(text) && Number(text) <= 100 ? Math.round(Number(text) * 1000) : null
  }
  const totals = documentTotals(
    lines.map((line) => {
      const { quantity, unitPrice } = numbers(line)
      return { quantity: quantity ?? 0, unitPrice: unitPrice ?? 0, minutes: line.fixed ? line.minutes : null, tax1: line.tax1, tax2: line.tax2 }
    }),
    { discountPercent: rate('discountPercent'), tax1Percent: rate('tax1Percent'), tax2Percent: rate('tax2Percent') },
  )
  const money = (amount: number) => formatMoney(amount, currency)
  const [problem, setProblem] = useState<string | null>(null)

  const save = (event: FormEvent) => {
    event.preventDefault()
    const bad = lines.findIndex((line) => {
      const { quantity, unitPrice } = numbers(line)
      return quantity === null || unitPrice === null
    })
    setProblem(bad === -1 ? null : `Line ${bad + 1} needs a quantity such as 1.5 and a price such as 125.00.`)
    if (bad !== -1) return
    void submit((result) =>
      onSubmit(
        result,
        lines.map((line) => {
          const { quantity, unitPrice } = numbers(line)
          return {
            id: line.id, description: line.description, quantity: quantity ?? 0, unitPrice: unitPrice ?? 0, projectId: line.projectId === '' ? null : Number(line.projectId),
            categoryId: line.categoryId === '' ? null : Number(line.categoryId), tax1: line.tax1, tax2: line.tax2,
          }
        }),
      ),
    )
  }

  const hasTax = (name: 'tax1' | 'tax2') => (values[`${name}Percent`] ?? '') !== ''
  return (
    <form className="stack document-editor" noValidate onSubmit={save}>
      <FormMessages form={form} onReload={onReload} />
      <Card title="Details">
        <div className="stack">
          <Fields fields={fields} values={values} onChange={setValues} field={form.field} />
        </div>
      </Card>
      <Card title="Lines">
        <ol className="line-list">
          {lines.map((line, index) => {
            const name = `Line ${index + 1}`
            return (
              <li key={line.key}>
                <div role="group" aria-label={name} className="line-edit">
                <div className="line-what">
                  <TextArea label="Description" hideLabel rows={2} placeholder="Description" value={line.description} onChange={(description) => change(line.key, { description })} />
                  <div className="line-more">
                    {client.projects.length > 0 && !line.fixed && (
                      <Select
                        label="Project"
                        hideLabel
                        value={line.projectId}
                        options={[{ value: '', label: 'No project' }, ...client.projects.map(({ id, name: project }) => ({ value: String(id), label: project }))]}
                        onChange={(projectId) => change(line.key, { projectId })}
                      />
                    )}
                    {options.categories.length > 0 && (
                      <Select
                        label="Category"
                        hideLabel
                        value={line.categoryId}
                        options={[{ value: '', label: 'No category' }, ...options.categories.map(({ id, name: category }) => ({ value: String(id), label: category }))]}
                        onChange={(categoryId) => change(line.key, { categoryId })}
                      />
                    )}
                    {hasTax('tax1') && <Checkbox label="Tax" checked={line.tax1} onChange={(tax1) => change(line.key, { tax1 })} />}
                    {hasTax('tax2') && <Checkbox label="Second tax" checked={line.tax2} onChange={(tax2) => change(line.key, { tax2 })} />}
                  </div>
                </div>
                {line.fixed ? (
                  <p className="line-fixed muted">
                    {line.minutes === null ? '' : `${formatHours(line.minutes)} × ${money(line.stored.unitPrice)}`}
                  </p>
                ) : (
                  <div className="line-numbers">
                    <TextField label="Quantity" hideLabel inputMode="decimal" autoComplete="off" value={line.quantity} onChange={(quantity) => change(line.key, { quantity })} />
                    <TextField label="Price" hideLabel inputMode="decimal" autoComplete="off" placeholder="0.00" value={line.price} onChange={(price) => change(line.key, { price })} />
                  </div>
                )}
                <p className="line-amount figure">{money(totals.lineAmounts[index] ?? 0)}</p>
                <IconButton icon="trash" size="small" variant="quiet" label={`Remove line ${index + 1}`} onClick={() => setLines((before) => before.filter(({ key }) => key !== line.key))} />
                </div>
              </li>
            )
          })}
        </ol>
        {problem !== null && (
          <p className="field-error" role="alert">
            {problem}
          </p>
        )}
        <div className="line-foot">
          <Button icon="plus" onClick={() => setLines((before) => [...before, blank()])}>
            Add line
          </Button>
          <dl className="sum">
            <dt>Subtotal</dt>
            <dd>{money(totals.subtotal)}</dd>
            {totals.discount !== 0 && (
              <>
                <dt>Discount</dt>
                <dd>{money(-totals.discount)}</dd>
              </>
            )}
            {totals.tax1 + totals.tax2 !== 0 && (
              <>
                <dt>Tax</dt>
                <dd>{money(totals.tax1 + totals.tax2)}</dd>
              </>
            )}
            <dt className="sum-total">Total</dt>
            <dd className="sum-total">{money(totals.total)}</dd>
          </dl>
        </div>
      </Card>
      <Card title="Taxes, discount and notes">
        <div className="stack">
          <Fields fields={taxSpecs} values={values} onChange={setValues} field={form.field} />
        </div>
      </Card>
      <div className="form-actions">
        <LinkButton to={cancelTo}>Cancel</LinkButton>
        <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
