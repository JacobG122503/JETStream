import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { ToastProvider } from './Toasts'
import { type ToastApi, useToast } from './toastContext'

let toast: ToastApi
function Sample() {
  toast = useToast()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Dialog">
        <Button>Inside</Button>
      </Dialog>
    </>
  )
}

const region = () => screen.getByRole('region', { name: 'Notifications' })
const messages = () => [...region().querySelectorAll('.toast-message')].map((message) => message.lastElementChild?.textContent)
const wait = (ms: number) => {
  act(() => void vi.advanceTimersByTime(ms))
}

beforeEach(() => {
  vi.useFakeTimers()
  render(
    <ToastProvider>
      <Sample />
    </ToastProvider>,
  )
})
afterEach(() => vi.useRealTimers())

describe('toasts', () => {
  it.each(['success', 'info'] as const)('%s is polite and disappears after 5 seconds', (kind) => {
    act(() => toast[kind]('Saved'))
    wait(100)
    expect(within(region()).getByRole('status')).toHaveTextContent(/^(Success|Information) Saved$/)
    wait(4800)
    expect(messages()).toEqual(['Saved'])
    wait(200)
    expect(messages()).toEqual([])
  })

  it.each(['warning', 'error'] as const)('%s is assertive and stays until dismissed', (kind) => {
    act(() => toast[kind]('Careful'))
    expect(within(region()).getByRole('alert')).toHaveTextContent(/^(Warning|Error) Careful$/)
    wait(60_000)
    expect(messages()).toEqual(['Careful'])
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Careful' }))
    expect(messages()).toEqual([])
  })

  it('shows three and queues the rest in order', () => {
    act(() => {
      for (const n of [1, 2, 3, 4, 5]) toast.info(`Message ${n}`)
    })
    wait(100)
    expect(messages()).toEqual(['Message 1', 'Message 2', 'Message 3'])
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Message 2' }))
    wait(100)
    expect(messages()).toEqual(['Message 1', 'Message 3', 'Message 4'])
    wait(4900)
    wait(100)
    expect(messages()).toContain('Message 5')
  })

  it('pauses the countdown on hover and on focus', () => {
    act(() => toast.success('Saved'))
    wait(3000)
    const box = region().querySelector('.toast') as HTMLElement
    fireEvent.pointerOver(box)
    wait(10_000)
    expect(messages()).toEqual(['Saved'])
    fireEvent.pointerMove(document.body)
    wait(1000)
    act(() => screen.getByRole('button', { name: 'Dismiss: Saved' }).focus())
    wait(10_000)
    expect(messages()).toEqual(['Saved'])
    act(() => screen.getByRole('button', { name: 'Open' }).focus())
    wait(1001)
    expect(messages()).toEqual([])
  })

  it('runs an action once and goes', () => {
    const onAction = vi.fn()
    act(() => toast.success('Removed', { action: { label: 'Undo', onAction } }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(messages()).toEqual([])
  })

  it('never takes focus', () => {
    const button = screen.getByRole('button', { name: 'Open' })
    act(() => button.focus())
    act(() => toast.error('Failed'))
    wait(100)
    expect(button).toHaveFocus()
  })

  it('gives focus back after being dismissed with the keyboard', () => {
    const button = screen.getByRole('button', { name: 'Open' })
    act(() => button.focus())
    act(() => toast.error('Failed'))
    act(() => screen.getByRole('button', { name: 'Dismiss: Failed' }).focus())
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Failed' }))
    wait(10)
    expect(button).toHaveFocus()
  })

  it('stays usable above a dialog, also with the Tab key', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    act(() => toast.error('Failed'))
    expect(region()).not.toHaveAttribute('inert')
    const inside = screen.getByRole('button', { name: 'Inside' })
    act(() => inside.focus())
    fireEvent.keyDown(inside, { key: 'Tab' })
    const dismiss = screen.getByRole('button', { name: 'Dismiss: Failed' })
    expect(dismiss).toHaveFocus()
    fireEvent.keyDown(dismiss, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Tab', shiftKey: true })
    expect(dismiss).toHaveFocus()
    fireEvent.keyDown(dismiss, { key: 'Escape' })
    expect(messages()).toEqual([])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
