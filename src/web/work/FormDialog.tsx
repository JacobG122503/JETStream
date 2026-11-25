import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { useWeekStart } from '../auth/authContext'
import { FormMessages } from '../auth/FormMessages'
import { useForm } from '../auth/useForm'
import { Button, Checkbox, Combobox, type ComboboxOption, DatePicker, Dialog, MultiCombobox, Select, type SelectOption, TextArea, TextField } from '../ui'
import { hoursInput, moneyInput, parseHours, parseMoney } from './format'

export type RawValue = string | string[] | boolean | null
export type RawValues = Record<string, RawValue>

export interface FieldSpec {
  name: string
  label: string
  /** What is typed, and what comes out: money as minor units, percent as thousandths, hours as minutes, ids as numbers. */
  type: 'text' | 'area' | 'email' | 'whole' | 'money' | 'percent' | 'hours' | 'date' | 'select' | 'id' | 'combo' | 'ids' | 'names' | 'check'
  required?: boolean
  hint?: ReactNode
  placeholder?: string
  options?: SelectOption[] | ComboboxOption[]
  currency?: string
  rows?: number
  /** Whether it is there, given the rest. */
  show?: (values: RawValues) => boolean
  disabled?: boolean
  /** Beside the next one. */
  half?: boolean
}

const percentText = /^\d{1,3}(?:\.\d{1,3})?$/

/** What a field holds, for the server; `problem` when it is not what it must be. */
function convert({ type, required, label, currency = 'USD' }: FieldSpec, raw: RawValue): { value: unknown; problem?: string } {
  if (type === 'check') return { value: raw === true }
  if (type === 'ids') {
    const ids = (raw as string[]).map(Number)
    return required && ids.length === 0 ? { value: ids, problem: `Choose ${label.toLowerCase()}.` } : { value: ids }
  }
  if (type === 'names') return { value: (raw as string).split(',').map((name) => name.trim()).filter(Boolean) }
  const text = typeof raw === 'string' ? raw.trim() : ''
  const choice = type === 'select' || type === 'id' || type === 'combo' || type === 'date'
  if (text === '') {
    const empty = type === 'text' || type === 'area' ? '' : null
    return required ? { value: empty, problem: choice ? `Choose ${label.toLowerCase()}.` : `Enter ${label.toLowerCase()}.` } : { value: empty }
  }
  switch (type) {
    case 'id':
    case 'combo':
      return { value: Number(text) }
    case 'whole':
      return /^-?\d{1,9}$/.test(text) ? { value: Number(text) } : { value: null, problem: 'Enter a whole number.' }
    case 'money': {
      const amount = parseMoney(text, currency)
      return amount === null ? { value: null, problem: 'Enter an amount such as 125.00.' } : { value: amount }
    }
    case 'percent':
      return percentText.test(text) && Number(text) <= 100 ? { value: Math.round(Number(text) * 1000) } : { value: null, problem: 'Enter a percentage from 0 to 100.' }
    case 'hours': {
      const minutes = parseHours(text)
      return minutes === null ? { value: null, problem: 'Enter hours such as 7.5.' } : { value: minutes }
    }
    default:
      return { value: text }
  }
}

/** How a stored value is shown in its field. */
function toRaw({ type, currency = 'USD' }: FieldSpec, value: unknown): RawValue {
  if (type === 'check') return value === true
  if (type === 'ids') return Array.isArray(value) ? value.map(String) : []
  if (type === 'names') return Array.isArray(value) ? value.join(', ') : ''
  if (value === null || value === undefined) return type === 'combo' ? null : ''
  if (type === 'money') return moneyInput(value as number, currency)
  if (type === 'percent') return String((value as number) / 1000)
  if (type === 'hours') return hoursInput(value as number)
  return String(value as string | number)
}

interface FieldsProps {
  fields: FieldSpec[]
  values: RawValues
  onChange: (values: RawValues) => void
  field: (name: string) => { id: string; error: string | null }
}

export function Fields({ fields, values, onChange, field }: FieldsProps) {
  const weekStart = useWeekStart()
  const set = (name: string) => (value: RawValue) => onChange({ ...values, [name]: value })
  const one = (spec: FieldSpec) => {
    const { name, label, type, required, hint, placeholder, disabled, options = [], rows = 3, currency } = spec
    const raw = values[name] ?? ''
    const common = { label: type === 'money' && currency ? `${label} (${currency})` : label, required, hint, disabled, ...field(name) }
    const text = typeof raw === 'string' ? raw : ''
    switch (type) {
      case 'area':
        return <TextArea {...common} rows={rows} value={text} onChange={set(name)} />
      case 'date':
        return <DatePicker {...common} weekStart={weekStart} value={text} onChange={set(name)} />
      case 'select':
      case 'id':
        return <Select {...common} placeholder={placeholder} value={text} options={options} onChange={set(name)} />
      case 'combo':
        return <Combobox {...common} placeholder={placeholder} value={typeof raw === 'string' && raw !== '' ? raw : null} options={options} onChange={set(name)} />
      case 'ids':
        return <MultiCombobox {...common} placeholder={placeholder} value={Array.isArray(raw) ? raw : []} options={options} onChange={set(name)} />
      case 'check':
        return <Checkbox {...common} checked={raw === true} onChange={set(name)} />
      default:
        return (
          <TextField
            {...common}
            type={type === 'email' ? 'email' : 'text'}
            inputMode={type === 'money' || type === 'percent' || type === 'hours' ? 'decimal' : type === 'whole' ? 'numeric' : undefined}
            autoComplete="off"
            placeholder={placeholder}
            value={text}
            onChange={set(name)}
          />
        )
    }
  }
  const shown = fields.filter(({ show }) => !show || show(values))
  const rows: FieldSpec[][] = []
  for (const spec of shown) {
    const last = rows.at(-1)
    if (spec.half && last?.length === 1 && last[0]?.half) last.push(spec)
    else rows.push([spec])
  }
  return (
    <>
      {rows.map((row) =>
        row.length === 2 ? (
          <div key={row[0]?.name} className="form-pair">
            {row.map((spec) => (
              <div key={spec.name}>{one(spec)}</div>
            ))}
          </div>
        ) : (
          <div key={row[0]?.name}>{row[0] && one(row[0])}</div>
        ),
      )}
    </>
  )
}

/** The state of such a form. */
// eslint-disable-next-line react-refresh/only-export-components -- belongs to the fields
export function useFields(name: string, fields: FieldSpec[], initial: Record<string, unknown>) {
  const [names] = useState(() => fields.map((field) => field.name))
  const form = useForm(name, names)
  const [values, setValues] = useState<RawValues>(() => Object.fromEntries(fields.map((field) => [field.name, toRaw(field, initial[field.name])])))
  const submit = (work: (values: Record<string, never>) => Promise<void>) => {
    const problems: Record<string, string> = {}
    const result: Record<string, unknown> = {}
    for (const field of fields) {
      const hidden = field.show && !field.show(values)
      const { value, problem } = hidden ? { value: toEmpty(field), problem: undefined } : convert(field, values[field.name] ?? '')
      result[field.name] = value
      if (problem) problems[field.name] = problem
    }
    return form.submit(() => work(result as Record<string, never>), problems)
  }
  return { form, values, setValues, submit }
}

const toEmpty = ({ type }: FieldSpec): unknown => (type === 'check' ? false : type === 'ids' || type === 'names' ? [] : type === 'text' || type === 'area' ? '' : null)

export interface FormDialogProps {
  title: string
  submitLabel: string
  fields: FieldSpec[]
  initial?: Record<string, unknown>
  /** Above the fields. */
  intro?: ReactNode
  /** At the start of the footer, such as a button that deletes. */
  extra?: ReactNode
  size?: 'small' | 'medium' | 'large'
  onClose: () => void
  onReload?: () => void
  onSubmit: (values: Record<string, never>) => Promise<void>
}

/** A dialog that is a form. Rejecting `onSubmit` keeps it open and says what is wrong. */
export function FormDialog({ title, submitLabel, fields, initial = {}, intro, extra, size, onClose, onReload, onSubmit }: FormDialogProps) {
  const formId = useId()
  const { form, values, setValues, submit } = useFields(formId.replaceAll(':', ''), fields, initial)
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size={size}
      closeOnOutsidePress={false}
      busy={form.busy}
      footer={
        <>
          {extra}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={form.busy} loadingLabel="Saving">
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="stack"
        noValidate
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          void submit(onSubmit)
        }}
      >
        <FormMessages form={form} onReload={onReload} />
        {intro}
        <Fields fields={fields} values={values} onChange={setValues} field={form.field} />
      </form>
    </Dialog>
  )
}
