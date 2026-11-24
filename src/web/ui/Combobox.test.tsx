import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Combobox, MultiCombobox } from './Combobox'
import { type ComboboxOption, filterOptions } from './comboboxFilter'

const options: ComboboxOption[] = [
  { value: 'conveyor', label: 'Conveyor retrofit', group: 'Acme Fabrication' },
  { value: 'press', label: 'Press line controls', group: 'Acme Fabrication' },
  { value: 'relay', label: 'Substation relay upgrade', group: 'Northline Utilities', disabled: true },
  { value: 'pump', label: 'Pump station telemetry', group: 'Northline Utilities' },
]

function Single({ initial = null, onChange }: { initial?: string | null; onChange?: (value: string | null) => void }) {
  const [value, setValue] = useState<string | null>(initial)
  return (
    <Combobox
      label="Project"
      options={options}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

function Multi({ onChange }: { onChange?: (value: string[]) => void }) {
  const [value, setValue] = useState<string[]>([])
  return (
    <MultiCombobox
      label="Projects"
      options={options}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

const input = () => screen.getByRole('combobox')
const shown = () => screen.queryAllByRole('option').map((option) => option.textContent)

describe('filterOptions', () => {
  it('matches the option or its group, ignoring case and accents', () => {
    expect(filterOptions(options, 'ACM').map((option) => option.value)).toEqual(['conveyor', 'press'])
    expect(filterOptions(options, 'utilities  pump').map((option) => option.value)).toEqual(['pump'])
    expect(filterOptions([{ value: 'x', label: 'Café' }], 'cafe')).toHaveLength(1)
    expect(filterOptions(options, '  ')).toHaveLength(4)
    expect(filterOptions(options, 'zzz')).toHaveLength(0)
  })
})

describe('Combobox', () => {
  it('filters by client, and Down then Enter chooses the first project', async () => {
    const onChange = vi.fn()
    render(<Single onChange={onChange} />)
    await userEvent.type(input(), 'acm')
    expect(input()).toHaveAttribute('aria-expanded', 'true')
    expect(shown()).toEqual(['Conveyor retrofit', 'Press line controls'])
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-labelledby'))).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Acme Fabrication' })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}')
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]?.id)
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('conveyor')
    expect(input()).toHaveValue('Conveyor retrofit')
    expect(input()).toHaveAttribute('aria-expanded', 'false')
  })

  it('says when nothing matches', async () => {
    const onChange = vi.fn()
    render(<Single onChange={onChange} />)
    await userEvent.type(input(), 'zzz{ArrowDown}{Enter}')
    expect(screen.getByText('No matches')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('moves both ways, round the ends and past disabled options', async () => {
    render(<Single />)
    await userEvent.click(input())
    const active = () => document.getElementById(input().getAttribute('aria-activedescendant') ?? '')?.textContent
    const seen: (string | null | undefined)[] = []
    for (const key of ['{ArrowDown}', '{ArrowDown}', '{ArrowDown}', '{ArrowDown}', '{ArrowUp}']) {
      await userEvent.keyboard(key)
      seen.push(active())
    }
    expect(seen).toEqual(['Conveyor retrofit', 'Press line controls', 'Pump station telemetry', 'Conveyor retrofit', 'Pump station telemetry'])
  })

  it('closes on Escape without choosing, and shows the earlier choice again', async () => {
    const onChange = vi.fn()
    render(<Single initial="pump" onChange={onChange} />)
    await userEvent.type(input(), 'acm{ArrowDown}{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input()).toHaveValue('Pump station telemetry')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('can be cleared', async () => {
    const onChange = vi.fn()
    render(<Single initial="pump" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Clear Project' }))
    expect(onChange).toHaveBeenCalledWith(null)
    expect(input()).toHaveValue('')
    expect(input()).toHaveFocus()
  })

  it('keeps its arrow when disabled, as a button that does nothing', () => {
    render(<Combobox label="Project" disabled options={[]} value={null} onChange={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Show options for Project' })).toBeDisabled()
  })

  it('does not choose a disabled option', async () => {
    const onChange = vi.fn()
    render(<Single onChange={onChange} />)
    await userEvent.click(input())
    const option = screen.getByRole('option', { name: 'Substation relay upgrade' })
    expect(option).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(option)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('marks the chosen option', async () => {
    render(<Single initial="pump" />)
    await userEvent.click(input())
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Pump station telemetry')
  })

  it('shows the right matches after each key with 500 options', async () => {
    const many = Array.from({ length: 500 }, (_, index) => ({ value: String(index), label: `Order ${index}` }))
    render(<Combobox label="Order" options={many} value={null} onChange={() => undefined} />)
    let text = ''
    for (const key of 'order 49') {
      text += key
      await userEvent.type(input(), key)
      expect(shown()).toEqual(many.map((option) => option.label).filter((label) => label.toLowerCase().includes(text.trim())))
    }
    expect(shown()).toEqual(['Order 49', ...Array.from({ length: 10 }, (_, index) => `Order 49${index}`)])
  }, 30_000)
})

describe('MultiCombobox', () => {
  it('adds and removes choices and stays open', async () => {
    const onChange = vi.fn()
    render(<Multi onChange={onChange} />)
    await userEvent.type(input(), 'press{ArrowDown}{Enter}')
    await userEvent.type(input(), 'pump{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(['press', 'pump'])
    expect(input()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true')
    expect(screen.getAllByRole('option', { selected: true })).toHaveLength(2)
    const chosen = screen.getByRole('list', { name: 'Projects: chosen' })
    expect(within(chosen).getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(within(chosen).getByRole('button', { name: 'Remove Press line controls' }))
    expect(onChange).toHaveBeenLastCalledWith(['pump'])
    await userEvent.type(input(), '{Backspace}')
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('clears all choices', async () => {
    const onChange = vi.fn()
    render(<Multi onChange={onChange} />)
    await userEvent.type(input(), 'press{ArrowDown}{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Clear Projects' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })
})
