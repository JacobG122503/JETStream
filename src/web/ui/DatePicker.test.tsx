import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatePicker, type DatePickerProps } from './DatePicker'
import { DateRangePicker, type DateRangePickerProps } from './DateRangePicker'

function Sample({ initial = '', onChange, ...rest }: Partial<DatePickerProps> & { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <DatePicker
      label="Work date"
      today="2026-11-23"
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

const field = () => screen.getByRole('textbox', { name: 'Work date' })
const openCalendar = () => userEvent.click(screen.getByRole('button', { name: 'Choose Work date from a calendar' }))
const focusedDay = () => document.activeElement?.getAttribute('aria-label')

const zone = process.env.TZ
afterEach(() => {
  if (zone === undefined) delete process.env.TZ
  else process.env.TZ = zone
})

describe('DatePicker, typing', () => {
  it.each(['2026-11-24', '11/24/2026'])('accepts %s and shows Nov 24, 2026', async (text) => {
    const onChange = vi.fn()
    render(<Sample onChange={onChange} />)
    await userEvent.type(field(), text)
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.tab()
    expect(onChange.mock.calls).toEqual([['2026-11-24']])
    expect(field()).toHaveValue('Nov 24, 2026')
  })

  it('accepts a leap day and refuses one that does not exist, without giving a value', async () => {
    const onChange = vi.fn()
    const onProblemChange = vi.fn()
    render(<Sample initial="2026-11-23" onChange={onChange} onProblemChange={onProblemChange} />)
    await userEvent.clear(field())
    await userEvent.type(field(), '2/29/2027{Enter}')
    expect(field()).toBeInvalid()
    expect(field()).toHaveAccessibleDescription(/Enter a date such as/)
    expect(field()).toHaveValue('2/29/2027')
    expect(onChange).not.toHaveBeenCalled()
    expect(onProblemChange).toHaveBeenLastCalledWith(expect.stringContaining('Enter a date'))
    await userEvent.clear(field())
    await userEvent.type(field(), '2028-02-29{Enter}')
    expect(onChange.mock.calls).toEqual([['2028-02-29']])
    expect(field()).toBeValid()
    expect(onProblemChange).toHaveBeenLastCalledWith(null)
  })

  it('refuses dates outside min and max', async () => {
    const onChange = vi.fn()
    render(<Sample min="2026-11-10" max="2026-11-20" onChange={onChange} />)
    await userEvent.type(field(), '11/9/2026{Enter}')
    expect(field()).toHaveAccessibleDescription(/on or after Nov 10, 2026/)
    await userEvent.clear(field())
    await userEvent.type(field(), '11/21/2026{Enter}')
    expect(field()).toHaveAccessibleDescription(/on or before Nov 20, 2026/)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('emptying the field gives an empty value, and so does Clear', async () => {
    const onChange = vi.fn()
    render(<Sample initial="2026-11-23" onChange={onChange} />)
    await userEvent.clear(field())
    await userEvent.tab()
    expect(onChange).toHaveBeenLastCalledWith('')
    await userEvent.type(field(), '2026-11-24{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Clear Work date' }))
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(field()).toHaveFocus()
  })

  it('does nothing when left unchanged', async () => {
    const onChange = vi.fn()
    render(<Sample initial="2026-11-23" onChange={onChange} />)
    await userEvent.click(field())
    await userEvent.tab()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('can be read-only, without a calendar', () => {
    render(<Sample initial="2026-11-23" readOnly />)
    expect(field()).toHaveAttribute('readonly')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('DatePicker, calendar', () => {
  it('opens at the value, marks it and today, and starts weeks on Monday', async () => {
    render(<Sample initial="2026-11-10" />)
    await openCalendar()
    expect(screen.getByRole('dialog', { name: 'Calendar for Work date' })).toBeInTheDocument()
    expect(focusedDay()).toBe('Tuesday, November 10, 2026, selected')
    expect(screen.getByRole('gridcell', { selected: true })).toHaveTextContent('10')
    expect(screen.getByRole('button', { current: 'date' })).toHaveAccessibleName(/November 23, 2026, today/)
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Monday')
  })

  it('can start weeks on Sunday', async () => {
    render(<Sample weekStart={0} />)
    await openCalendar()
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Sunday')
    await userEvent.keyboard('{Home}')
    expect(focusedDay()).toContain('Sunday, November 22')
  })

  it('moves with the keyboard', async () => {
    render(<Sample initial="2026-11-25" />)
    await openCalendar()
    for (const [key, day] of [
      ['{ArrowRight}', 'November 26, 2026'],
      ['{ArrowLeft}', 'November 25, 2026'],
      ['{ArrowUp}', 'November 18, 2026'],
      ['{ArrowDown}', 'November 25, 2026'],
      ['{Home}', 'Monday, November 23, 2026'],
      ['{End}', 'Sunday, November 29, 2026'],
      ['{PageDown}', 'December 29, 2026'],
      ['{PageUp}', 'November 29, 2026'],
      ['{Shift>}{PageDown}{/Shift}', 'November 29, 2027'],
      ['{Shift>}{PageUp}{/Shift}', 'November 29, 2026'],
    ] as const) {
      await userEvent.keyboard(key)
      expect(focusedDay()).toContain(day)
    }
  })

  it('PageDown from January 31 goes to February 28', async () => {
    render(<Sample initial="2026-01-31" />)
    await openCalendar()
    await userEvent.keyboard('{PageDown}')
    expect(focusedDay()).toContain('February 28, 2026')
  })

  it('Enter chooses and Escape does not; both return focus', async () => {
    const onChange = vi.fn()
    render(<Sample initial="2026-11-23" onChange={onChange} />)
    const opener = screen.getByRole('button', { name: 'Choose Work date from a calendar' })
    await openCalendar()
    await userEvent.keyboard('{ArrowRight}{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(opener).toHaveFocus()
    await openCalendar()
    await userEvent.keyboard('{ArrowRight}{Enter}')
    expect(onChange).toHaveBeenCalledWith('2026-11-24')
    expect(opener).toHaveFocus()
    expect(field()).toHaveValue('Nov 24, 2026')
  })

  it('keeps to min and max', async () => {
    const onChange = vi.fn()
    render(<Sample min="2026-11-10" max="2026-11-24" onChange={onChange} />)
    await openCalendar()
    await userEvent.keyboard('{PageDown}')
    expect(focusedDay()).toContain('November 24, 2026')
    expect(screen.getByRole('button', { name: /November 25, 2026/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next month' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{PageUp}')
    expect(focusedDay()).toContain('November 10, 2026')
  })

  it('has buttons for months, years, today and clearing', async () => {
    const onChange = vi.fn()
    render(<Sample initial="2026-01-15" onChange={onChange} />)
    await openCalendar()
    const popup = screen.getByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(within(popup).getByText('February 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next month' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(within(popup).getByText('February 2025')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-11-23')
    await openCalendar()
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it.each(['America/Los_Angeles', 'Pacific/Auckland'])('is not shifted by clock changes in %s', async (timeZone) => {
    process.env.TZ = timeZone
    const onChange = vi.fn()
    render(<Sample initial="2026-03-01" onChange={onChange} />)
    await openCalendar()
    await userEvent.click(screen.getByRole('button', { name: /^Sunday, March 8, 2026/ }))
    expect(onChange).toHaveBeenLastCalledWith('2026-03-08')
    await userEvent.clear(field())
    await userEvent.type(field(), '11/2/2026{Enter}')
    await openCalendar()
    await userEvent.click(screen.getByRole('button', { name: /^Sunday, November 1, 2026/ }))
    expect(onChange).toHaveBeenLastCalledWith('2026-11-01')
  })
})

describe('DateRangePicker', () => {
  function Range({ onChange, ...rest }: Partial<DateRangePickerProps>) {
    const [value, setValue] = useState({ start: '', end: '' })
    return (
      <DateRangePicker
        label="Report dates"
        today="2026-11-23"
        {...rest}
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
      />
    )
  }
  const period = () => screen.getByRole('combobox', { name: 'Period' })
  const start = () => screen.getByRole('textbox', { name: 'Start date' })
  const end = () => screen.getByRole('textbox', { name: 'End date' })

  it('offers the presets, for the given week start', async () => {
    const onChange = vi.fn()
    const { unmount } = render(<Range onChange={onChange} />)
    expect(within(period()).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'This week', 'Last week', 'This month', 'Last month', 'This quarter', 'This year', 'Custom',
    ])
    expect(period()).toHaveDisplayValue('Custom')
    await userEvent.selectOptions(period(), 'This week')
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-11-23', end: '2026-11-29' })
    expect(start()).toHaveValue('Nov 23, 2026')
    await userEvent.selectOptions(period(), 'This quarter')
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-10-01', end: '2026-12-31' })
    unmount()
    render(<Range onChange={onChange} weekStart={0} />)
    await userEvent.selectOptions(period(), 'This week')
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-11-22', end: '2026-11-28' })
  })

  it('becomes Custom when a date is changed', async () => {
    const onChange = vi.fn()
    render(<Range onChange={onChange} />)
    await userEvent.selectOptions(period(), 'This week')
    await userEvent.clear(end())
    await userEvent.type(end(), '11/27/2026{Enter}')
    expect(period()).toHaveDisplayValue('Custom')
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-11-23', end: '2026-11-27' })
  })

  it('shows an error and gives no value when the end is before the start', async () => {
    const onChange = vi.fn()
    render(<Range onChange={onChange} />)
    await userEvent.type(start(), '11/20/2026{Enter}')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Report dates' })).toHaveAccessibleDescription('Enter an end date to use this range.')
    await userEvent.type(end(), '11/10/2026{Enter}')
    expect(onChange).not.toHaveBeenCalled()
    expect(end()).toBeInvalid()
    expect(end()).toHaveAccessibleDescription('Error: The end date must be on or after Nov 20, 2026')
    await userEvent.clear(end())
    await userEvent.type(end(), '11/20/2026{Enter}')
    expect(onChange.mock.calls).toEqual([[{ start: '2026-11-20', end: '2026-11-20' }]])
    expect(end()).toBeValid()
  })
})
