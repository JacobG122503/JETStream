import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { Button, IconButton, LinkButton } from './Button'

it('is not a submit button unless asked', () => {
  render(<Button>Save</Button>)
  expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
})

it('can be disabled', async () => {
  const onClick = vi.fn()
  render(
    <Button disabled onClick={onClick}>
      Save
    </Button>,
  )
  await userEvent.click(screen.getByRole('button'))
  expect(onClick).not.toHaveBeenCalled()
})

it('while loading keeps its name and focus, is busy, ignores clicks and does not submit', async () => {
  const onClick = vi.fn()
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
  const ui = (loading: boolean) => (
    <form onSubmit={onSubmit}>
      <Button type="submit" loading={loading} loadingLabel="Saving" onClick={onClick}>
        Save
      </Button>
    </form>
  )
  const { rerender } = render(ui(false))
  const button = screen.getByRole('button', { name: 'Save' })
  await userEvent.click(button)
  expect(onSubmit).toHaveBeenCalledTimes(1)
  rerender(ui(true))
  expect(button).toHaveAttribute('aria-busy', 'true')
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toHaveAccessibleName('Save')
  expect(button).toHaveFocus()
  await userEvent.click(button)
  await userEvent.keyboard('{Enter} ')
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(onSubmit).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(document.querySelector('[data-announcer]')).toHaveTextContent('Saving'))
})

it('needs a name when it has only an icon', () => {
  render(<IconButton icon="plus" label="Add entry" />)
  expect(screen.getByRole('button', { name: 'Add entry' })).toBeInTheDocument()
  // @ts-expect-error -- no label
  expect(() => <IconButton icon="plus" />).not.toThrow()
})

it('can be a link', () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LinkButton to="/time">Go</LinkButton>
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/time')
})
