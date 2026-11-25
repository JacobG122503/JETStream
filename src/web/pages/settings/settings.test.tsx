import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { App } from '../../App'
import { routerFuture, routes } from '../../routes'
import { fakeServer } from '../../test/fakeServer'
import { person, sessionInfo } from '../../test/session'
import { resetThemeChoice } from '../../theme/theme'

const server = fakeServer()
beforeEach(() => {
  server.session = sessionInfo({ person })
})
afterEach(() => {
  localStorage.clear()
  resetThemeChoice()
})

const open = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture })
  return { router, ...render(<App router={router} />) }
}

it('is for everyone, without what they may not open', async () => {
  open('/settings')
  expect(await screen.findByRole('heading', { level: 2, name: 'My preferences' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument()
})

it('sets the theme', async () => {
  open('/settings')
  await userEvent.click(await screen.findByRole('radio', { name: 'Dark' }))
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  await userEvent.click(screen.getByRole('radio', { name: 'System' }))
  expect(document.documentElement).not.toHaveAttribute('data-theme')
})

it('sets where the app begins', async () => {
  const first = open('/settings')
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Show Home when you open the app' }))
  first.unmount()
  const { router } = open('/')
  await screen.findByRole('heading', { level: 1, name: 'Timesheet' })
  expect(router.state.location.pathname).toBe('/time')
})
