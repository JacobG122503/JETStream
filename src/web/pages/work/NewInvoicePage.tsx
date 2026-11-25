import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { UnbilledClient } from '../../../shared/work'
import { callApi } from '../../api'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Avatar, Button, Card, Checkbox, DatePicker, EmptyState, ErrorState, LinkButton, LoadingState, RadioGroup, TextField, useToast } from '../../ui'
import { formatHours, formatMoney } from '../../work/format'
import '../../work/work.css'

const fields = ['projectIds', 'subject', 'from', 'to', 'grouping'] as const

export function NewInvoicePage() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { status, data, error, reload } = useLoad<{ clients: UnbilledClient[] }>(`invoices/unbilled?from=${from}&to=${to}`)
  const [clientId, setClientId] = useState<number | null>(null)
  const client = data?.clients.find(({ id }) => id === clientId)
  return (
    <Page
      title="New invoice"
      description="Made of hours and expenses that are not on an invoice yet."
      actions={
        <LinkButton to="/invoices" icon="chevronLeft">
          Invoices
        </LinkButton>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading what can be invoiced" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && (
        <>
          <section className="stack" aria-labelledby="choose-client">
            <h2 id="choose-client" className="section-title">
              Choose a client
            </h2>
            {data.clients.length === 0 ? (
              <EmptyState icon="success" headingLevel={3} title="Everything is invoiced" description="There are no hours or expenses to bill in this period." />
            ) : (
              <ul className="cards">
                {data.clients.map(({ id, name, total, currency, projects }) => (
                  <li key={id}>
                    <button type="button" className="client-card" aria-pressed={id === clientId} onClick={() => setClientId(id)}>
                      <span className="client-head">
                        <Avatar name={name} decorative />
                        <span className="cell-two">
                          <span className="strong">{name}</span>
                          <span className="cell-sub">{projects.length === 1 ? '1 project' : `${projects.length} projects`}</span>
                        </span>
                      </span>
                      <span className="client-total">{formatMoney(total, currency)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {client && <InvoiceForm key={client.id} client={client} from={from} to={to} onFrom={setFrom} onTo={setTo} />}
        </>
      )}
    </Page>
  )
}

interface InvoiceFormProps {
  client: UnbilledClient
  from: string
  to: string
  onFrom: (date: string) => void
  onTo: (date: string) => void
}

function InvoiceForm({ client, from, to, onFrom, onTo }: InvoiceFormProps) {
  const toast = useToast()
  const navigate = useNavigate()
  const form = useForm('invoice', fields)
  const [left, setLeft] = useState<number[]>([])
  const [withExpenses, setWithExpenses] = useState(true)
  const [grouping, setGrouping] = useState('task')
  const [subject, setSubject] = useState('')
  const chosen = client.projects.filter(({ id }) => !left.includes(id))
  const time = chosen.reduce((sum, { timeAmount }) => sum + timeAmount, 0)
  const spent = chosen.reduce((sum, { expenseAmount }) => sum + expenseAmount, 0)
  const total = time + (withExpenses ? spent : 0)
  const money = (amount: number) => formatMoney(amount, client.currency)
  const missing = chosen.reduce((sum, { withoutRate }) => sum + withoutRate, 0)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        const body = { clientId: client.id, projectIds: chosen.map(({ id }) => id), from: from || null, to: to || null, grouping, withExpenses, subject }
        const { id } = await callApi<{ id: number }>('POST', 'invoices', body)
        toast.success('Draft created')
        navigate(`/invoices/${id}`)
      },
      { projectIds: chosen.length === 0 ? 'Choose at least one project.' : null },
    )
  }

  return (
    <form className="columns columns-wide" noValidate onSubmit={submit}>
      <Card title={`What to bill ${client.name}`}>
        <div className="stack">
          <FormMessages form={form} />
          <fieldset className="stack">
            <legend className="field-label">Projects</legend>
            <ul className="pick-list" id={form.field('projectIds').id} tabIndex={-1}>
              {client.projects.map((project) => (
                <li key={project.id}>
                  <Checkbox
                    label={project.name}
                    hint={[
                      project.minutes > 0 && `${formatHours(project.minutes)} hours, ${money(project.timeAmount)}`,
                      project.expenseAmount > 0 && `expenses ${money(project.expenseAmount)}`,
                    ]
                      .filter(Boolean)
                      .join(' and ')}
                    checked={!left.includes(project.id)}
                    onChange={(on) => setLeft((before) => (on ? before.filter((id) => id !== project.id) : [...before, project.id]))}
                  />
                </li>
              ))}
            </ul>
          </fieldset>
          <Checkbox label="Include billable expenses" checked={withExpenses} onChange={setWithExpenses} />
          <div className="form-pair">
            <DatePicker label="From" hint="Leave empty for everything." value={from} onChange={onFrom} {...form.field('from')} />
            <DatePicker label="To" value={to} onChange={onTo} {...form.field('to')} />
          </div>
          <TextField label="Subject" placeholder="Engineering services" value={subject} onChange={setSubject} {...form.field('subject')} />
        </div>
      </Card>
      <div className="stack">
        <Card title="Lines">
          <RadioGroup
            label="One line for each"
            hideLabel
            value={grouping}
            options={[
              { value: 'task', label: 'Task' },
              { value: 'person', label: 'Person' },
              { value: 'project', label: 'Project' },
              { value: 'detailed', label: 'Entry' },
            ]}
            onChange={setGrouping}
          />
        </Card>
        <Card>
          <dl className="sum">
            <dt>Hours</dt>
            <dd>{money(time)}</dd>
            <dt>Expenses</dt>
            <dd>{money(withExpenses ? spent : 0)}</dd>
            <dt className="sum-total">Subtotal</dt>
            <dd className="sum-total">{money(total)}</dd>
          </dl>
          <p className="form-note">The client's taxes and discount are added on the draft.</p>
          {missing > 0 && <p className="form-note">{missing} entries are left out, because no rate applies to them.</p>}
          <div className="form-wide sum-action">
            <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Creating the draft" aria-disabled={total === 0 || undefined}>
              Create draft
            </Button>
          </div>
        </Card>
      </div>
    </form>
  )
}
