import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactElement, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Combobox, DatePicker, Checkbox, type FormError, FormErrorSummary, MultiCombobox, RadioGroup, SearchField, Select, Switch, TextArea, TextField } from '.'

const noop = () => undefined
const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', disabled: true },
]
const shared = { label: 'Thing', hint: 'A hint', error: 'A problem', required: true }

describe.each<[string, string, ReactElement, ReactElement]>([
  ['TextField', 'textbox', <TextField {...shared} value="" onChange={noop} />, <TextField label="Thing" disabled value="" onChange={noop} />],
  ['email', 'textbox', <TextField {...shared} type="email" value="" onChange={noop} />, <TextField label="Thing" type="email" disabled value="" onChange={noop} />],
  ['number', 'spinbutton', <TextField {...shared} type="number" value="" onChange={noop} />, <TextField label="Thing" type="number" disabled value="" onChange={noop} />],
  ['TextArea', 'textbox', <TextArea {...shared} value="" onChange={noop} />, <TextArea label="Thing" disabled value="" onChange={noop} />],
  ['Select', 'combobox', <Select {...shared} options={options} value="a" onChange={noop} />, <Select label="Thing" disabled options={options} value="a" onChange={noop} />],
  ['SearchField', 'searchbox', <SearchField {...shared} value="" onChange={noop} />, <SearchField label="Thing" disabled value="" onChange={noop} />],
  ['Checkbox', 'checkbox', <Checkbox {...shared} checked={false} onChange={noop} />, <Checkbox label="Thing" disabled checked={false} onChange={noop} />],
  ['Switch', 'switch', <Switch {...shared} checked={false} onChange={noop} />, <Switch label="Thing" disabled checked={false} onChange={noop} />],
  ['Combobox', 'combobox', <Combobox {...shared} options={options} value={null} onChange={noop} />, <Combobox label="Thing" disabled options={options} value={null} onChange={noop} />],
  ['MultiCombobox', 'combobox', <MultiCombobox {...shared} options={options} value={[]} onChange={noop} />, <MultiCombobox label="Thing" disabled options={options} value={[]} onChange={noop} />],
  ['DatePicker', 'textbox', <DatePicker {...shared} value="" onChange={noop} />, <DatePicker label="Thing" disabled value="" onChange={noop} />],
])('%s', (_name, role, withEverything, disabled) => {
  it('has its label, hint, error and required mark tied to it', () => {
    render(withEverything)
    const control = screen.getByRole(role, { name: /^Thing \(required\)$/ })
    expect(control).toBeInvalid()
    expect(control).toBeRequired()
    expect(control).toHaveAccessibleDescription('A hint Error: A problem')
  })

  it('can be disabled', () => {
    render(disabled)
    expect(screen.getByRole(role, { name: 'Thing' })).toBeDisabled()
  })
})

it('password fields are labelled and hide what is typed', () => {
  render(<TextField label="Password" type="password" value="x" onChange={noop} />)
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
})

it('text fields can be read-only', () => {
  render(
    <>
      <TextField label="Code" readOnly value="JET" onChange={noop} />
      <TextArea label="Notes" readOnly value="Text" onChange={noop} />
    </>,
  )
  for (const field of screen.getAllByRole('textbox')) expect(field).toHaveAttribute('readonly')
})

it('a radio group has its label, hint, error and required mark tied to it', async () => {
  const onChange = vi.fn()
  render(<RadioGroup {...shared} options={[...options, { value: 'c', label: 'Gamma', hint: 'More' }]} value="a" onChange={onChange} />)
  const group = screen.getByRole('radiogroup', { name: 'Thing (required)' })
  expect(group).toHaveAttribute('aria-invalid', 'true')
  expect(group).toHaveAttribute('aria-required', 'true')
  expect(group).toHaveAccessibleDescription('A hint Error: A problem')
  expect(screen.getByRole('radio', { name: 'Alpha' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Beta' })).toBeDisabled()
  await userEvent.click(screen.getByRole('radio', { name: /Gamma/ }))
  expect(onChange).toHaveBeenCalledWith('c')
})

it('a checkbox can be neither on nor off', async () => {
  const onChange = vi.fn()
  render(<Checkbox label="All" checked={false} indeterminate onChange={onChange} />)
  expect(screen.getByRole('checkbox')).toBePartiallyChecked()
  await userEvent.click(screen.getByText('All'))
  expect(onChange).toHaveBeenCalledWith(true)
})

it('a search field can be cleared and keeps focus', async () => {
  function Sample() {
    const [value, setValue] = useState('pump')
    return <SearchField label="Search projects" value={value} onChange={setValue} />
  }
  render(<Sample />)
  await userEvent.click(screen.getByRole('button', { name: 'Clear Search projects' }))
  expect(screen.getByRole('searchbox')).toHaveValue('')
  expect(screen.getByRole('searchbox')).toHaveFocus()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

describe('FormErrorSummary', () => {
  function Form() {
    const [errors, setErrors] = useState<FormError[]>([])
    const [count, setCount] = useState(0)
    return (
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          setCount(count + 1)
          setErrors([
            { fieldId: 'name', message: 'Enter a name' },
            { fieldId: 'kind', message: 'Choose a kind' },
          ])
        }}
      >
        <FormErrorSummary errors={errors} submitCount={count} />
        <TextField id="name" label="Name" value="" onChange={noop} />
        <RadioGroup id="kind" label="Kind" options={options} value="" onChange={noop} />
        <button>Save</button>
      </form>
    )
  }

  it('takes focus on a failed submit and leads to each field without changing the address', async () => {
    render(<Form />)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    const before = window.location.href
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const summary = screen.getByRole('group', { name: 'There are 2 problems' })
    expect(summary).toHaveFocus()
    expect(within(summary).getAllByRole('link').map((link) => link.textContent)).toEqual(['Enter a name', 'Choose a kind'])
    await userEvent.click(within(summary).getByRole('link', { name: 'Enter a name' }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await userEvent.click(within(summary).getByRole('link', { name: 'Choose a kind' }))
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveFocus()
    expect(window.location.href).toBe(before)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(summary).toHaveFocus()
  })
})
