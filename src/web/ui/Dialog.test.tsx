import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { ConfirmDialog, Dialog, type DialogProps } from './Dialog'
import { Menu } from './Menu'

function Sample(props: Partial<DialogProps>) {
  const [open, setOpen] = useState(false)
  return (
    <main>
      <h1>Page</h1>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Edit entry" footer={<Button>Save</Button>} {...props}>
        <input aria-label="Notes" />
      </Dialog>
    </main>
  )
}

const open = () => userEvent.click(screen.getByRole('button', { name: 'Open', hidden: true }))

describe('Dialog', () => {
  it('is named by its title, makes the rest inert and locks scrolling', async () => {
    const { container } = render(<Sample />)
    await open()
    expect(screen.getByRole('dialog', { name: 'Edit entry' })).toHaveFocus()
    expect(container).toHaveAttribute('inert')
    expect(document.documentElement.style.overflow).toBe('hidden')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container).not.toHaveAttribute('inert')
    expect(document.documentElement.style.overflow).toBe('')
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
  })

  it('keeps focus inside', async () => {
    render(<Sample />)
    await open()
    const names: (string | null)[] = []
    for (let i = 0; i < 4; i++) {
      await userEvent.tab()
      names.push(document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? null)
    }
    expect(names).toEqual(['Close', 'Notes', 'Save', 'Close'])
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
  })

  it('closes with its button and on a press outside', async () => {
    render(<Sample />)
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await open()
    await userEvent.click(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(document.querySelector('.dialog-layer') as Element)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('can ignore a press outside', async () => {
    render(<Sample closeOnOutsidePress={false} />)
    await open()
    await userEvent.click(document.querySelector('.dialog-layer') as Element)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('moves focus to the page heading when its opener is gone', async () => {
    function Vanishing() {
      const [isOpen, setOpen] = useState(false)
      const [gone, setGone] = useState(false)
      return (
        <main>
          <h1>Page</h1>
          {!gone && <Button onClick={() => setOpen(true)}>Open</Button>}
          <Dialog open={isOpen} onClose={() => setOpen(false)} title="Remove">
            <Button
              onClick={() => {
                setGone(true)
                setOpen(false)
              }}
            >
              Remove it
            </Button>
          </Dialog>
        </main>
      )
    }
    render(<Vanishing />)
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Page' })).toHaveFocus())
  })

  it('returns focus to the menu button when opened from a menu', async () => {
    function FromMenu() {
      const [isOpen, setOpen] = useState(false)
      return (
        <>
          <Menu label="Actions" items={[{ id: 'a', label: 'Edit', onSelect: () => setOpen(true) }]} />
          <Dialog open={isOpen} onClose={() => setOpen(false)} title="Edit">
            Text
          </Dialog>
        </>
      )
    }
    render(<FromMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }))
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus()
  })

  it('above another dialog closes on its own', async () => {
    function Two() {
      const [first, setFirst] = useState(true)
      const [second, setSecond] = useState(false)
      return (
        <>
          <Dialog open={first} onClose={() => setFirst(false)} title="First">
            <Button onClick={() => setSecond(true)}>More</Button>
          </Dialog>
          <Dialog open={second} onClose={() => setSecond(false)} title="Second">
            Text
          </Dialog>
        </>
      )
    }
    render(<Two />)
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('dialog', { name: 'First' }).parentElement).toHaveAttribute('inert')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Second' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus()
  })
})

describe('ConfirmDialog', () => {
  function Confirm({ onConfirm, destructive = true }: { onConfirm: () => unknown; destructive?: boolean }) {
    const [isOpen, setOpen] = useState(true)
    return (
      <ConfirmDialog
        open={isOpen}
        onClose={() => setOpen(false)}
        title="Delete project?"
        message="Its time entries go too."
        confirmLabel="Delete project"
        destructive={destructive}
        onConfirm={() => onConfirm() as Promise<unknown>}
      />
    )
  }

  it('names the action and focuses Cancel first when destructive', async () => {
    const onConfirm = vi.fn()
    render(<Confirm onConfirm={onConfirm} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Its time entries go too.')
    await userEvent.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('focuses the action when harmless', () => {
    render(<Confirm onConfirm={() => undefined} destructive={false} />)
    expect(screen.getByRole('button', { name: 'Delete project' })).toHaveFocus()
  })

  it('cannot be closed or submitted again while the action runs, and closes on success', async () => {
    let finish: () => void = () => undefined
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<Confirm onConfirm={onConfirm} />)
    const action = screen.getByRole('button', { name: 'Delete project' })
    await userEvent.dblClick(action)
    expect(action).toHaveAttribute('aria-busy', 'true')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(document.querySelector('.dialog-layer') as Element)
    await userEvent.click(action)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish()
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays open with the error when the action fails, and can be tried again', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('Could not delete')))
    render(<Confirm onConfirm={onConfirm} />)
    const action = screen.getByRole('button', { name: 'Delete project' })
    await userEvent.click(action)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete')
    expect(action).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveAttribute('aria-disabled')
    await userEvent.click(action)
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })
})
