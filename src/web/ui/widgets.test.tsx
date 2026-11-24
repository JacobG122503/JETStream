import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Avatar, Badge, Button, Card, EmptyState, ErrorBoundary, ErrorState, FilterBar, LoadingState, Menu, PageHeader, ProgressBar, Spinner, StatTile, Tabs, Tooltip } from '.'

describe('Tabs', () => {
  const items = ['One', 'Two', 'Three'].map((label) => ({ id: label, label, content: `Content ${label}` }))

  it('have tab roles and move with the arrow keys, Home and End', async () => {
    render(<Tabs label="Sample" items={items} />)
    expect(screen.getByRole('tablist', { name: 'Sample' })).toBeInTheDocument()
    const selected = () => screen.getByRole('tab', { selected: true })
    expect(selected()).toHaveTextContent('One')
    expect(screen.getByRole('tabpanel', { name: 'One' })).toHaveTextContent('Content One')
    await userEvent.click(selected())
    for (const [key, name] of [['ArrowRight', 'Two'], ['ArrowLeft', 'One'], ['ArrowLeft', 'Three'], ['ArrowRight', 'One'], ['End', 'Three'], ['Home', 'One']]) {
      await userEvent.keyboard(`{${key}}`)
      expect(selected()).toHaveTextContent(name as string)
      expect(selected()).toHaveFocus()
    }
    await userEvent.tab()
    expect(screen.getByRole('tabpanel')).toHaveFocus()
  })

  it('can be controlled', async () => {
    const onChange = vi.fn()
    render(<Tabs label="Sample" items={items} value="Two" onChange={onChange} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Three' }))
    expect(onChange).toHaveBeenCalledWith('Three')
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Two')
  })
})

describe('Menu', () => {
  const setup = () => {
    const onEdit = vi.fn()
    const onArchive = vi.fn()
    render(
      <Menu
        label="Actions"
        items={[
          { id: 'edit', label: 'Edit', onSelect: onEdit },
          { id: 'archive', label: 'Archive', disabled: true, onSelect: onArchive },
          { id: 'delete', label: 'Delete', destructive: true, onSelect: () => undefined },
        ]}
      />,
    )
    return { onEdit, onArchive, button: screen.getByRole('button', { name: 'Actions' }) }
  }

  it.each(['{Enter}', ' ', '{ArrowDown}'])('opens with %s at the first item', async (key) => {
    const { button } = setup()
    button.focus()
    await userEvent.keyboard(key)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
  })

  it('moves with the arrow keys and by letter, round the ends', async () => {
    const { button } = setup()
    await userEvent.click(button)
    const names: (string | null | undefined)[] = []
    for (const key of ['{ArrowDown}', '{ArrowDown}', '{ArrowDown}', '{ArrowUp}', '{Home}', '{End}', 'a']) {
      await userEvent.keyboard(key)
      names.push(document.activeElement?.textContent)
    }
    expect(names).toEqual(['Archive', 'Delete', 'Edit', 'Delete', 'Edit', 'Delete', 'Archive'])
  })

  it('Escape closes it and returns focus', async () => {
    const { button } = setup()
    await userEvent.click(button)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('runs an item with Enter or a click, but not a disabled one', async () => {
    const { button, onEdit, onArchive } = setup()
    await userEvent.click(button)
    await userEvent.keyboard('{Enter}')
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(button).toHaveFocus()
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(onArchive).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledTimes(2)
  })

  it('closes on a press outside and on Tab', async () => {
    const { button } = setup()
    await userEvent.click(button)
    await userEvent.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.click(button)
    await userEvent.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('Tooltip', () => {
  afterEach(() => vi.useRealTimers())

  it('shows on focus, describes its control, and Escape hides it', async () => {
    render(
      <Tooltip text="Invoiced to the client">
        <Button>Billable</Button>
      </Tooltip>,
    )
    expect(screen.getByRole('button')).toHaveAccessibleDescription('Invoiced to the client')
    await userEvent.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Invoiced to the client')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveFocus()
  })

  it('shows on hover and stays while the pointer is on it', () => {
    vi.useFakeTimers()
    render(
      <Tooltip text="Help">
        <Button>Billable</Button>
      </Tooltip>,
    )
    const anchor = screen.getByRole('button').parentElement as HTMLElement
    fireEvent.pointerEnter(anchor, { pointerType: 'mouse' })
    act(() => void vi.advanceTimersByTime(400))
    fireEvent.pointerEnter(screen.getByRole('tooltip'))
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.pointerLeave(anchor)
    act(() => void vi.advanceTimersByTime(200))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('ProgressBar', () => {
  it.each([
    [0, '0', '0%', '0%'],
    [80, '80', '80%', '80%'],
    [100, '100', '100%', '100%'],
    [135, '100', '135%, Over budget by 35%', '100%'],
    [100.2, '100', '101%, Over budget by 1%', '100%'],
    [99.8, '99', '99%', '99%'],
  ])('at %d percent', (percent, now, text, width) => {
    const { container } = render(<ProgressBar label="Hours" percent={percent} />)
    const bar = screen.getByRole('progressbar', { name: 'Hours' })
    expect(bar).toHaveAttribute('aria-valuenow', now)
    expect(bar).toHaveAttribute('aria-valuetext', text)
    expect(container.querySelector<HTMLElement>('.progress-fill')?.style.width).toBe(width)
    expect(screen.queryByText(/Over budget by/) !== null).toBe(percent > 100)
  })
})

describe('Avatar', () => {
  it('shows initials without a picture, and when it cannot be loaded', () => {
    const { container, rerender } = render(<Avatar name="Dana Marie Whitfield" />)
    expect(screen.getByRole('img', { name: 'Dana Marie Whitfield' })).toHaveTextContent('DW')
    rerender(<Avatar name="Cher" src="/missing.png" />)
    expect(screen.getByRole('img', { name: 'Cher' })).not.toHaveTextContent('C')
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(screen.getByRole('img', { name: 'Cher' })).toHaveTextContent('C')
  })
})

it('badges, cards, tiles, headers and filter bars show what they are given', () => {
  render(
    <>
      <PageHeader title="Invoices" description="All of them" actions={<Button>New</Button>} />
      <Badge tone="danger">Overdue</Badge>
      <Card title="Summary" actions={<Button>More</Button>}>
        Text
      </Card>
      <StatTile label="Hours" value="31.50" detail="of 40" />
      <FilterBar label="Filter invoices" actions={<Button>Clear</Button>}>
        Fields
      </FilterBar>
    </>,
  )
  expect(screen.getByRole('heading', { level: 1, name: 'Invoices' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument()
  for (const text of ['All of them', 'Overdue', 'Text', '31.50', 'of 40', 'Fields']) expect(screen.getByText(text)).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'Filter invoices' })).toBeInTheDocument()
  expect(screen.getAllByRole('button')).toHaveLength(3)
})

describe('states', () => {
  it('announce loading', () => {
    render(
      <>
        <Spinner label="Loading projects" />
        <LoadingState label="Loading invoices" />
        <LoadingState label="Loading reports" look="skeleton" size="page" />
      </>,
    )
    expect(screen.getAllByRole('status').map((status) => status.textContent)).toEqual(['Loading projects...', 'Loading invoices...', 'Loading reports...'])
  })

  it('explain an empty place and offer an action', () => {
    render(<EmptyState headingLevel={2} title="No projects" description="Add the first one." action={<Button>Add project</Button>} />)
    expect(screen.getByRole('heading', { level: 2, name: 'No projects' })).toBeInTheDocument()
    expect(screen.getByText('Add the first one.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add project' })).toBeInTheDocument()
  })

  it('announce an error and offer another try', async () => {
    const onRetry = vi.fn()
    render(<ErrorState message="Could not load" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalled()
  })
})

describe('ErrorBoundary', () => {
  function Sample() {
    const [broken, setBroken] = useState(true)
    const [key, setKey] = useState('a')
    const Broken = () => {
      if (broken) throw new Error('broken')
      return <p>Fine</p>
    }
    return (
      <>
        <button onClick={() => setBroken(false)}>Repair</button>
        <button onClick={() => setKey('b')}>Leave</button>
        <ErrorBoundary resetKey={key} fallback={(retry) => <button onClick={retry}>Try again</button>}>
          <Broken />
        </ErrorBoundary>
      </>
    )
  }

  it('shows its fallback, and the content again after a retry or another key', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { unmount } = render(<Sample />)
    await userEvent.click(screen.getByRole('button', { name: 'Repair' }))
    expect(screen.queryByText('Fine')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('Fine')).toBeInTheDocument()
    unmount()
    render(<Sample />)
    await userEvent.click(screen.getByRole('button', { name: 'Repair' }))
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(screen.getByText('Fine')).toBeInTheDocument()
  })
})
