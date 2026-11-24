import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Table, type TableColumn, type TableProps } from './Table'

interface Row {
  id: string
  name: string
  hours: number | null
}

/** 60 rows; the Hours column repeats 2, 10, 9 and empty. */
const rows: Row[] = Array.from({ length: 60 }, (_, index) => ({
  id: `r${index + 1}`,
  name: `Row ${index + 1}`,
  hours: [2, 10, 9, null][index % 4] as number | null,
}))

const columns: TableColumn<Row>[] = [
  { id: 'name', header: 'Name', cell: (row) => row.name, sortValue: (row) => row.name },
  { id: 'hours', header: 'Hours', numeric: true, cell: (row) => row.hours ?? '', sortValue: (row) => row.hours, total: '315' },
  { id: 'note', header: 'Note', cell: () => 'x' },
]

function Sample(props: Partial<TableProps<Row>>) {
  return <Table caption="Entries" columns={columns} rows={rows} rowKey={(row) => row.id} rowLabel={(row) => row.name} {...props} />
}

const column = (index: number) =>
  within(screen.getAllByRole('rowgroup')[1] as HTMLElement)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell')[index]?.querySelector('.cell-value')?.textContent)

describe('Table', () => {
  it('is a real table with a caption, column headers and totals', () => {
    render(<Sample />)
    const table = screen.getByRole('table', { name: 'Entries' })
    expect(table.tagName).toBe('TABLE')
    expect(table.querySelector('caption')).toHaveTextContent('Entries')
    expect(screen.getAllByRole('columnheader').map((header) => header.tagName)).toEqual(['TH', 'TH', 'TH'])
    expect(table.querySelector('tfoot')).toHaveTextContent('315')
  })

  it('sorts all rows, both ways, with empty values last', async () => {
    const four = rows.slice(0, 4)
    render(<Sample rows={four} />)
    const header = screen.getByRole('columnheader', { name: 'Hours' })
    expect(header).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByRole('columnheader', { name: 'Note' })).not.toHaveAttribute('aria-sort')
    const button = within(header).getByRole('button', { name: 'Hours' })
    await userEvent.click(button)
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    expect(column(1)).toEqual(['2', '9', '10', ''])
    await userEvent.click(button)
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(column(1)).toEqual(['10', '9', '2', ''])
    await userEvent.click(button)
    expect(header).toHaveAttribute('aria-sort', 'ascending')
  })

  it('shows 25 rows per page, and sorting applies to all of them', async () => {
    render(<Sample />)
    expect(screen.getByText('1-25 of 60')).toBeInTheDocument()
    expect(column(0)).toHaveLength(25)
    const next = screen.getByRole('button', { name: 'Next page' })
    await userEvent.click(next)
    await userEvent.click(next)
    expect(screen.getByText('51-60 of 60')).toBeInTheDocument()
    expect(next).toHaveAttribute('aria-disabled', 'true')
    expect(next).toHaveFocus()
    await userEvent.click(next)
    expect(screen.getByText('51-60 of 60')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hours' }))
    expect(screen.getByText('1-25 of 60')).toBeInTheDocument()
    expect(column(1).slice(0, 16)).toEqual([...Array<string>(15).fill('2'), '9'])
  })

  it('selects only the page that is shown, with a mixed state', async () => {
    const seen = vi.fn()
    function Selecting() {
      const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
      return (
        <Sample
          selected={selected}
          onSelectedChange={(next) => {
            seen([...next])
            setSelected(next)
          }}
        />
      )
    }
    render(<Selecting />)
    const all = screen.getByRole('checkbox', { name: 'Select all rows on this page' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Row 3' }))
    expect(all).toBePartiallyChecked()
    await userEvent.click(all)
    expect(seen).toHaveBeenLastCalledWith(expect.arrayContaining(['r1', 'r25']))
    expect(seen.mock.lastCall?.[0]).toHaveLength(25)
    expect(all).toBeChecked()
    expect(screen.getByText(/25 selected/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(all).not.toBeChecked()
    expect(all).not.toBePartiallyChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Row 26' }))
    expect(seen.mock.lastCall?.[0]).toHaveLength(26)
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await userEvent.click(all)
    expect(seen).toHaveBeenLastCalledWith(['r26'])
  })

  it('has a place for actions of a row', () => {
    render(<Sample rows={rows.slice(0, 2)} rowActions={(row) => <button>Edit {row.name}</button>} />)
    expect(screen.getByRole('button', { name: 'Edit Row 2' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument()
  })

  it('shows loading, empty and error inside the table', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<Sample rows={[]} status="loading" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading Entries')
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    rerender(<Sample rows={[]} empty={{ title: 'No entries', description: 'Log some time.' }} />)
    expect(within(screen.getByRole('table')).getByText('No entries')).toBeInTheDocument()
    rerender(<Sample rows={[]} status="error" error="Could not load" onRetry={onRetry} />)
    expect(within(screen.getByRole('table')).getByRole('alert')).toHaveTextContent('Could not load')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalled()
    expect(document.body).not.toHaveFocus()
  })

  it('on a phone keeps labels with the values, and sorting and selecting all', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (media) => ({ media, matches: media.includes('max-width'), addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList,
    )
    render(<Sample rows={rows.slice(0, 4)} selected={new Set()} onSelectedChange={() => undefined} />)
    const cell = screen.getByRole('cell', { name: /10$/ })
    expect(cell).toHaveTextContent('Hours10')
    expect(screen.getAllByRole('checkbox', { name: 'Select all rows on this page' })).toHaveLength(1)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Hours')
    expect(column(2)).toEqual(['2', '9', '10', ''])
    await userEvent.click(screen.getByRole('button', { name: 'Ascending' }))
    expect(column(2)).toEqual(['10', '9', '2', ''])
  })

  it('marks only cells with a word that is too long to stay whole', () => {
    const named = (name: string, index: number): Row => ({ id: `r${index}`, name, hours: 1 })
    const { rerender } = render(<Sample rows={['Substation relay upgrade, phase two', 'x'.repeat(24), 'x'.repeat(25)].map(named)} />)
    const marked = () => screen.getAllByRole('cell').filter((cell) => cell.hasAttribute('data-long-word')).map((cell) => cell.querySelector('.cell-value')?.textContent)
    expect(marked()).toEqual(['x'.repeat(25)])
    rerender(<Sample rows={['Short'].map(named)} />)
    expect(marked()).toEqual([])
  })

  it('keeps the visible caption outside what scrolls, and says it once', () => {
    render(<Sample narrow="scroll" />)
    const [visible, real] = screen.getAllByText('Entries') as [HTMLElement, HTMLElement]
    expect(visible).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('region')).not.toContainElement(visible)
    expect(real.tagName).toBe('CAPTION')
  })

  it('has no visible caption when that is turned off', () => {
    render(<Sample hideCaption />)
    expect(screen.getByText('Entries')).toHaveClass('sr-only')
  })

  it('can scroll sideways in a labelled container that takes focus', () => {
    render(<Sample narrow="scroll" />)
    expect(screen.getByRole('region', { name: 'Entries' })).toHaveAttribute('tabindex', '0')
  })

  it('announces sorting and paging', async () => {
    render(<Sample />)
    await userEvent.click(screen.getByRole('button', { name: 'Name' }))
    await waitFor(() => expect(document.querySelector('[data-announcer]')).toHaveTextContent('Sorted by Name, ascending'))
  })
})
