import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PersonRate, PersonWork } from '../../../shared/work'
import { callApi } from '../../api'
import { useLoad } from '../../auth/useLoad'
import { Button, Card, ErrorState, formatDate, IconButton, LoadingState, Notice, useToast } from '../../ui'
import { type FieldSpec, FormDialog } from '../../work/FormDialog'
import { formatHours, formatMoney } from '../../work/format'
import { useActions } from '../../work/useActions'
import '../../work/work.css'

// eslint-disable-next-line react-refresh/only-export-components -- also for adding people
export const personFields: FieldSpec[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, half: true },
  { name: 'email', label: 'Email', type: 'email', required: true, half: true },
  { name: 'kind', label: 'Kind', type: 'select', options: [{ value: 'employee', label: 'Employee' }, { value: 'contractor', label: 'Contractor' }], half: true },
  { name: 'weeklyCapacityMinutes', label: 'Hours per week', type: 'hours', required: true, half: true },
  { name: 'phone', label: 'Phone', type: 'text', half: true },
  { name: 'startedOn', label: 'Started', type: 'date', half: true },
  { name: 'labels', label: 'Labels', type: 'names', hint: 'Such as Engineer, Technician. Separated by commas.' },
  { name: 'notes', label: 'Notes', type: 'area' },
]

/** Details and rates of a person. */
export function PersonWorkCards({ id, onChange }: { id: number; onChange: () => void }) {
  const { status, data, error, reload, setData } = useLoad<PersonWork>(`people/${id}/work`)
  const [editing, setEditing] = useState(false)
  const { ask, dialog } = useActions()
  const toast = useToast()
  const navigate = useNavigate()
  if (status === 'loading') return <LoadingState look="skeleton" label="Loading details" />
  if (!data) return <ErrorState message={error} onRetry={reload} />
  const archived = data.status === 'archived'
  const changed = () => {
    reload()
    onChange()
  }
  return (
    <>
      <Card
        title="Work"
        actions={
          data.canManage &&
          data.status !== 'pending' && (
            <>
              {!archived && (
                <Button icon="edit" size="small" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {data.refusal === null && (
                <Button
                  size="small"
                  onClick={() =>
                    ask({
                      title: archived ? `Restore ${data.name}?` : `Archive ${data.name}?`,
                      message: archived
                        ? 'They can sign in again with the password they had. Make a reset link if it should be a new one.'
                        : 'They are signed out and cannot sign in. Their timer stops. Time, expenses and invoices stay.',
                      confirmLabel: archived ? 'Restore' : 'Archive', route: `people/${id}/archive`, body: { archive: !archived }, done: archived ? 'Restored' : 'Archived', then: changed,
                    })
                  }
                >
                  {archived ? 'Restore' : 'Archive'}
                </Button>
              )}
              {data.refusal === null && (
                <Button
                  size="small"
                  onClick={() =>
                    ask({
                      title: `Delete ${data.name}?`, message: 'Only someone without any time, expenses or other records can be deleted.', confirmLabel: 'Delete', destructive: true, method: 'DELETE',
                      route: `people/${id}`, done: 'Deleted', then: () => navigate('/team'),
                    })
                  }
                >
                  Delete
                </Button>
              )}
            </>
          )
        }
      >
        <dl className="facts">
          <dt>Kind</dt>
          <dd>{data.kind === 'employee' ? 'Employee' : 'Contractor'}</dd>
          <dt>Hours per week</dt>
          <dd>{formatHours(data.weeklyCapacityMinutes)}</dd>
          <dt>Labels</dt>
          <dd>{data.labels.join(', ') || 'None'}</dd>
          {data.phone && (
            <>
              <dt>Phone</dt>
              <dd>{data.phone}</dd>
            </>
          )}
          {data.startedOn && (
            <>
              <dt>Started</dt>
              <dd>{formatDate(data.startedOn)}</dd>
            </>
          )}
          {data.notes && (
            <>
              <dt>Notes</dt>
              <dd className="lines">{data.notes}</dd>
            </>
          )}
        </dl>
      </Card>
      {(data.rates.length > 0 || data.mayEditRates.billable || data.mayEditRates.cost) && <Rates id={id} data={data} onChange={setData} />}
      {editing && (
        <FormDialog
          title={`Edit ${data.name}`}
          submitLabel="Save"
          initial={{ ...data }}
          fields={personFields}
          onClose={() => setEditing(false)}
          onReload={reload}
          onSubmit={async (values) => {
            setData(await callApi<PersonWork>('PUT', `people/${id}`, { ...values, version: data.version }))
            setEditing(false)
            onChange()
            toast.success('Saved')
          }}
        />
      )}
      {dialog}
    </>
  )
}

const kindNames = { billable: 'Billable rates', cost: 'Cost rates' } as const
const beginning = '1900-01-01'

function Rates({ id, data, onChange }: { id: number; data: PersonWork; onChange: (data: PersonWork) => void }) {
  const [editing, setEditing] = useState<{ kind: 'billable' | 'cost'; rate: PersonRate | null } | null>(null)
  const { ask, dialog } = useActions()
  const toast = useToast()
  const kinds = (['billable', 'cost'] as const).filter((kind) => data.mayEditRates[kind] || data.rates.some((rate) => rate.kind === kind))
  return (
    <div className="columns">
      {kinds.map((kind) => {
        const rates = data.rates.filter((rate) => rate.kind === kind).reverse()
        return (
          <Card
            key={kind}
            title={kindNames[kind]}
            actions={
              data.mayEditRates[kind] && (
                <Button size="small" icon="plus" onClick={() => setEditing({ kind, rate: null })}>
                  Add rate
                </Button>
              )
            }
          >
            {rates.length === 0 ? (
              <Notice tone="warning">{kind === 'billable' ? 'Without a rate, hours on projects that use personal rates cannot be invoiced.' : 'No cost rate yet.'}</Notice>
            ) : (
              <ul className="payments">
                {rates.map((rate) => (
                  <li key={rate.id}>
                    <span>
                      <span className="strong">{formatMoney(rate.rate, data.currency)}</span> <span className="muted">{rate.startsOn <= beginning ? 'from the beginning' : `from ${formatDate(rate.startsOn)}`}</span>
                    </span>
                    {data.mayEditRates[kind] && (
                      <span className="row-actions">
                        <IconButton size="small" variant="quiet" icon="edit" label={`Edit the rate of ${formatMoney(rate.rate, data.currency)}`} onClick={() => setEditing({ kind, rate })} />
                        <IconButton
                          size="small"
                          variant="quiet"
                          icon="trash"
                          label={`Delete the rate of ${formatMoney(rate.rate, data.currency)}`}
                          onClick={() =>
                            ask({
                              title: 'Delete this rate?', message: 'Amounts that are not invoiced yet change. Invoiced ones stay.', confirmLabel: 'Delete rate', destructive: true, method: 'DELETE',
                              route: `people/${id}/rates/${rate.id}`, done: 'Rate deleted', then: onChange,
                            })
                          }
                        />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )
      })}
      {editing && (
        <FormDialog
          title={editing.rate ? 'Edit rate' : 'Add rate'}
          submitLabel="Save rate"
          size="small"
          intro={<p className="muted">Amounts from this date on that are not invoiced yet change. Invoiced ones stay.</p>}
          initial={editing.rate ? { rate: editing.rate.rate, startsOn: editing.rate.startsOn <= beginning ? null : editing.rate.startsOn } : {}}
          fields={[
            { name: 'rate', label: 'Per hour', type: 'money', currency: data.currency, required: true },
            { name: 'startsOn', label: 'From', type: 'date', hint: 'Empty for from the beginning.' },
          ]}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            const { rate, startsOn } = values as unknown as { rate: number; startsOn: string | null }
            const body = { kind: editing.kind, rate, startsOn: startsOn ?? beginning, version: editing.rate?.version ?? null }
            onChange(editing.rate ? await callApi<PersonWork>('PUT', `people/${id}/rates/${editing.rate.id}`, body) : await callApi<PersonWork>('POST', `people/${id}/rates`, body))
            setEditing(null)
            toast.success('Rate saved')
          }}
        />
      )}
      {dialog}
    </div>
  )
}
