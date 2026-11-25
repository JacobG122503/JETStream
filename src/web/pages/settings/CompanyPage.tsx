import { type FormEvent, useRef, useState } from 'react'
import type { CompanySettings } from '../../../shared/work'
import { callApi, errorMessage } from '../../api'
import { useAuth } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { useLoad } from '../../auth/useLoad'
import { apiUrl } from '../../basePath'
import { Button, Card, ErrorState, LoadingState, monthNames, useToast, weekdayNames } from '../../ui'
import { currencies, taxFields, termFields } from '../../work/billing'
import { Fields, type FieldSpec, useFields } from '../../work/FormDialog'
import { SettingsLayout } from './SettingsLayout'

export function CompanyPage() {
  const { status, data, error, reload, setData } = useLoad<CompanySettings>('settings')
  return (
    <SettingsLayout title="Company settings" current="/settings/company">
      {status === 'loading' && <LoadingState look="skeleton" label="Loading the settings" />}
      {status === 'error' && <ErrorState message={error} onRetry={reload} />}
      {data && <CompanyForm key={data.version} settings={data} onSaved={setData} onReload={reload} />}
    </SettingsLayout>
  )
}

const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['America/Chicago', 'America/New_York', 'America/Denver', 'America/Los_Angeles', 'UTC']

const groups: { title: string; fields: FieldSpec[] }[] = [
  {
    title: 'Company',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'address', label: 'Address', type: 'area', hint: 'Shown on invoices and estimates.' },
      { name: 'currency', label: 'Currency', type: 'select', options: currencies.map((value) => ({ value, label: value })), half: true },
      { name: 'timeZone', label: 'Time zone', type: 'select', options: zones.map((value) => ({ value, label: value.replaceAll('_', ' ') })), half: true },
    ],
  },
  {
    title: 'Weeks and formats',
    fields: [
      { name: 'weekStartsOn', label: 'The week starts on', type: 'id', options: weekdayNames.map((label, value) => ({ value: String(value), label })), half: true },
      { name: 'fiscalYearStartMonth', label: 'The fiscal year starts in', type: 'id', options: monthNames.map((label, index) => ({ value: String(index + 1), label })), half: true },
      { name: 'hourFormat', label: 'Hours', type: 'select', options: [{ value: 'decimal', label: '6.25' }, { value: 'hours_minutes', label: '6:15' }], half: true },
      { name: 'dateFormat', label: 'Dates', type: 'select', options: [{ value: 'mdy', label: 'Nov 25, 2026' }, { value: 'dmy', label: '25 Nov 2026' }, { value: 'ymd', label: '2026-11-25' }], half: true },
      { name: 'numberFormat', label: 'Numbers', type: 'select', options: ['1,234.56', '1.234,56', '1 234,56'].map((value) => ({ value, label: value })), half: true },
      {
        name: 'currencyPlacement', label: 'Amounts', type: 'select', half: true,
        options: [{ value: 'symbol_before', label: '$100' }, { value: 'symbol_after', label: '100 $' }, { value: 'code_before', label: 'USD 100' }, { value: 'code_after', label: '100 USD' }],
      },
      { name: 'timeFormat', label: 'Times of day', type: 'select', options: [{ value: '12h', label: '2:30 PM' }, { value: '24h', label: '14:30' }] },
    ],
  },
  {
    title: 'Timesheets',
    fields: [
      { name: 'timeMode', label: 'Time is entered as', type: 'select', options: [{ value: 'duration', label: 'Hours' }, { value: 'start_end', label: 'Start and end' }], half: true },
      { name: 'roundingMode', label: 'Rounding in reports and invoices', type: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'up', label: 'Up' }, { value: 'nearest', label: 'Nearest' }, { value: 'down', label: 'Down' }], half: true },
      { name: 'roundingMinutes', label: 'Round to', type: 'id', options: [5, 6, 10, 15, 30].map((value) => ({ value: String(value), label: `${value} minutes` })), show: ({ roundingMode }) => roundingMode !== 'off' },
      { name: 'approvalEnabled', label: 'Weeks are submitted for approval', type: 'check' },
      { name: 'timeNotesRequired', label: 'Time needs notes', type: 'check' },
      { name: 'expenseNotesRequired', label: 'Expenses need notes', type: 'check' },
      { name: 'lockAfterDays', label: 'Lock a week this many days after it ends', type: 'whole', hint: 'Empty for never.', half: true },
      { name: 'lockedThrough', label: 'Everything is locked up to', type: 'date', half: true },
    ],
  },
  {
    title: 'What is used',
    fields: [
      { name: 'expensesEnabled', label: 'Expenses', type: 'check' },
      { name: 'invoicesEnabled', label: 'Invoices', type: 'check' },
      { name: 'estimatesEnabled', label: 'Estimates', type: 'check' },
      { name: 'timeOffEnabled', label: 'Time off', type: 'check' },
      { name: 'schedulingEnabled', label: 'Schedule', type: 'check' },
    ],
  },
  {
    title: 'New clients, invoices and estimates',
    fields: [
      ...termFields,
      ...taxFields,
      { name: 'invoiceNotes', label: 'Notes on invoices', type: 'area' },
      { name: 'estimateNotes', label: 'Notes on estimates', type: 'area' },
      { name: 'estimateValidDays', label: 'Estimates are valid for, days', type: 'whole', required: true, half: true },
      { name: 'reminderText', label: 'Late reminders, days after the due date', type: 'text', placeholder: '3, 14, 30', half: true },
    ],
  },
]
const all = groups.flatMap(({ fields }) => fields)

function CompanyForm({ settings, onSaved, onReload }: { settings: CompanySettings; onSaved: (settings: CompanySettings) => void; onReload: () => void }) {
  const toast = useToast()
  const { refresh } = useAuth()
  const { form, values, setValues, submit } = useFields('company', all, { ...settings, reminderText: settings.reminderDays.join(', ') })
  const save = (event: FormEvent) => {
    event.preventDefault()
    void submit(async (result) => {
      const { reminderText, roundingMinutes, ...rest } = result as unknown as Record<string, unknown> & { reminderText: string; roundingMinutes: number | null }
      const reminderDays = reminderText.split(/[\s,]+/).filter(Boolean).map(Number)
      onSaved(await callApi<CompanySettings>('PUT', 'settings', { ...rest, roundingMinutes: roundingMinutes ?? settings.roundingMinutes, reminderDays, version: settings.version }))
      toast.success('Settings saved')
      void refresh()
    })
  }
  return (
    <form className="stack" noValidate onSubmit={save}>
      <FormMessages form={form} onReload={onReload} />
      <Logo settings={settings} onSaved={onSaved} />
      {groups.map(({ title, fields }) => (
        <Card key={title} title={title}>
          <div className="stack">
            <Fields fields={fields} values={values} onChange={setValues} field={form.field} />
          </div>
        </Card>
      ))}
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving the settings">
          Save settings
        </Button>
      </div>
    </form>
  )
}

function Logo({ settings, onSaved }: { settings: CompanySettings; onSaved: (settings: CompanySettings) => void }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<CompanySettings>, message: string) => {
    setBusy(true)
    try {
      onSaved(await work())
      toast.success(message)
    } catch (reason) {
      toast.error(errorMessage(reason))
    }
    setBusy(false)
  }
  return (
    <Card title="Logo">
      <div className="logo-row">
        {settings.logoFileId !== null && <img className="company-logo" src={`${apiUrl('logo')}?v=${settings.logoFileId}`} alt="The company's logo" />}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void run(() => callApi<CompanySettings>('PUT', 'settings/logo', file), 'Logo saved')
          }}
        />
        <Button loading={busy} loadingLabel="Saving the logo" onClick={() => input.current?.click()}>
          Choose a logo
        </Button>
        {settings.logoFileId !== null && <Button onClick={() => void run(() => callApi<CompanySettings>('DELETE', 'settings/logo'), 'Logo removed')}>Remove</Button>}
        <p className="form-note">PNG or JPEG. Shown on invoices and estimates.</p>
      </div>
    </Card>
  )
}
