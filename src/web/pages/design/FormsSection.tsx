import { type FormEvent, useState } from 'react'
import { Button, Checkbox, type FormError, FormErrorSummary, RadioGroup, SearchField, Select, Switch, TextArea, TextField } from '../../ui'
import { Example, Section } from './Section'

const roles = [
  { value: 'member', label: 'Member' },
  { value: 'lead', label: 'Project lead' },
  { value: 'admin', label: 'Administrator' },
]
const rateOptions = [
  { value: 'hourly', label: 'Hourly', hint: 'Time at the rate of each person' },
  { value: 'fixed', label: 'Fixed fee' },
  { value: 'none', label: 'Not billable' },
  { value: 'retainer', label: 'Retainer', disabled: true },
]

/** What a field sample keeps, so that every example can be used. */
function useText(initial = '') {
  const [value, onChange] = useState(initial)
  return { value, onChange }
}

function TextFields() {
  return (
    <>
      <Example title="Text, email, password, number" layout="grid">
        <TextField label="Project name" hint="As the client knows it" {...useText()} />
        <TextField label="Email" type="email" required autoComplete="off" {...useText()} />
        <TextField label="Password" type="password" autoComplete="new-password" {...useText()} />
        <TextField label="Budget hours" type="number" min={0} step="0.25" {...useText('120')} />
      </Example>
      <Example title="Field states" layout="grid">
        <TextField label="With an error" error="Enter a project name" {...useText()} />
        <TextField label="Read-only" readOnly {...useText('JET-2026-014')} />
        <TextField label="Disabled" disabled {...useText('Not used')} />
        <TextField label="With a hint and an error" hint="Between 1 and 100" error="Enter a number up to 100" required {...useText('250')} />
      </Example>
      <Example title="Multi-line text" layout="grid">
        <TextArea label="Notes" hint="Shown on the timesheet" {...useText()} />
        <TextArea label="Notes with an error" error="Enter at least a few words" required {...useText()} />
        <TextArea label="Read-only notes" readOnly {...useText('Sample note that cannot be changed.')} />
        <TextArea label="Disabled notes" disabled {...useText()} />
      </Example>
      <Example title="Select" layout="grid">
        <Select label="Role" options={roles} {...useText('member')} />
        <Select label="Role with an error" options={roles} placeholder="Choose a role" required error="Choose a role" {...useText()} />
        <Select label="Disabled role" options={roles} disabled {...useText('lead')} />
      </Example>
      <Example title="Search" layout="grid">
        <SearchField label="Search projects" placeholder="Name or client" {...useText('conveyor')} />
        <SearchField label="Disabled search" disabled {...useText()} />
      </Example>
    </>
  )
}

function Choices() {
  const [checks, setChecks] = useState({ billable: true, some: false, error: false })
  const [on, setOn] = useState(true)
  const [offWithError, setOffWithError] = useState(false)
  return (
    <>
      <Example title="Checkbox" layout="grid">
        <Checkbox label="Billable" checked={checks.billable} onChange={(billable) => setChecks({ ...checks, billable })} />
        <Checkbox label="Some of several" indeterminate={!checks.some} checked={checks.some} onChange={(some) => setChecks({ ...checks, some })} />
        <Checkbox label="I have checked the hours" required hint="Needed to submit" error="Confirm the hours" checked={checks.error} onChange={(error) => setChecks({ ...checks, error })} />
        <Checkbox label="Disabled" disabled checked onChange={() => undefined} />
      </Example>
      <Example title="Radio group" layout="grid">
        <RadioGroup label="Billing" options={rateOptions} required {...useText('hourly')} />
        <RadioGroup label="Billing with an error" options={rateOptions} error="Choose how it is billed" {...useText()} />
        <RadioGroup label="Disabled billing" options={rateOptions.slice(0, 2)} disabled {...useText('fixed')} />
      </Example>
      <Example title="Switch" layout="grid">
        <Switch label="Remind me on Fridays" hint="Applies at once" checked={on} onChange={setOn} />
        <Switch label="With an error" error="This could not be turned on" checked={offWithError} onChange={setOffWithError} />
        <Switch label="Disabled, off" disabled checked={false} onChange={() => undefined} />
        <Switch label="Disabled, on" disabled checked onChange={() => undefined} />
      </Example>
    </>
  )
}

function SampleForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitCount, setSubmitCount] = useState(0)
  const [errors, setErrors] = useState<FormError[]>([])
  const [done, setDone] = useState(false)
  const errorFor = (fieldId: string) => errors.find((error) => error.fieldId === fieldId)?.message

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found: FormError[] = []
    if (name.trim() === '') found.push({ fieldId: 'sample-name', message: 'Enter a contact name' })
    if (!/^\S+@\S+$/.test(email)) found.push({ fieldId: 'sample-email', message: 'Enter an email address, such as name@example.com' })
    setErrors(found)
    setSubmitCount((count) => count + 1)
    setDone(found.length === 0)
  }

  return (
    <form className="gallery-form" noValidate onSubmit={submit} aria-label="Sample form">
      <FormErrorSummary errors={errors} submitCount={submitCount} />
      <TextField id="sample-name" label="Contact name" required value={name} onChange={setName} error={errorFor('sample-name')} autoComplete="off" />
      <TextField id="sample-email" label="Contact email" type="email" required value={email} onChange={setEmail} error={errorFor('sample-email')} autoComplete="off" />
      <div>
        <Button type="submit" variant="primary">
          Check the sample form
        </Button>
      </div>
      <p role="status">{done && 'Both fields are fine. Nothing was sent.'}</p>
    </form>
  )
}

export function FormsSection() {
  return (
    <Section id="forms" title="Forms">
      <TextFields />
      <Choices />
      <Example title="Form with an error summary" layout="block" note="Submit it empty: the summary gets focus and leads to each field.">
        <SampleForm />
      </Example>
    </Section>
  )
}
