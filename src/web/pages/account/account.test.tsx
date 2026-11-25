import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it } from 'vitest'
import type { Account, SignedInDevice } from '../../../shared/api'
import { App } from '../../App'
import { routerFuture, routes } from '../../routes'
import { failure, fakeServer } from '../../test/fakeServer'
import { person, sessionInfo } from '../../test/session'
import { middleSquare, PhotoError, shrinkPhoto } from './shrinkPhoto'

const account: Account = { name: 'Casey Example', email: 'casey@jet.example', role: 'Member', timeZone: 'America/Chicago', photoId: null, version: 4 }
const device = (id: number, more: Partial<SignedInDevice> = {}): SignedInDevice => ({
  id, browser: 'Firefox', system: 'Windows', signedInAt: '2026-03-02T15:00:00Z', lastUsedAt: '2026-03-02T16:30:00Z', current: false, ...more,
})

const server = fakeServer()
beforeEach(async () => {
  server.session = sessionInfo({ person })
  server.handlers['GET account'] = () => account
  server.handlers['GET account/access'] = () => ({ role: { key: 'member', name: 'Member' }, administrator: false, grants: {}, managedProjects: [], managedPeople: [] })
  server.handlers['GET account/sessions'] = () => ({ sessions: [device(1, { current: true, browser: 'Chrome' }), device(2)] })
  render(<App router={createMemoryRouter(routes, { initialEntries: ['/account'], future: routerFuture })} />)
  await screen.findByRole('heading', { level: 2, name: 'Profile' })
})

const press = (name: string) => userEvent.click(screen.getByRole('button', { name }))

it('saves the profile with the version it was read at, and shows the new name in the header', async () => {
  expect(screen.getByText('casey@jet.example')).toBeInTheDocument()
  expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument()
  const name = screen.getByLabelText(/^Name/)
  await userEvent.clear(name)
  await userEvent.type(name, 'Casey New')
  server.handlers['PUT account/profile'] = () => ({ ...account, name: 'Casey New', version: 5 })
  server.session = sessionInfo({ person: { ...person, name: 'Casey New' } })
  await press('Save profile')
  expect(await screen.findByRole('button', { name: /^Account: Casey New/ })).toBeInTheDocument()
  expect(server.sent('PUT account/profile')[0]?.body).toEqual({ name: 'Casey New', timeZone: 'America/Chicago', version: 4 })
})

it('keeps what was typed when the profile changed elsewhere, and offers to reload', async () => {
  const name = screen.getByLabelText(/^Name/)
  await userEvent.type(name, ' typed')
  server.handlers['PUT account/profile'] = () => failure(409, 'stale', { message: 'Someone else changed this.' })
  await press('Save profile')
  expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed this.')
  expect(name).toHaveValue('Casey Example typed')
  server.handlers['GET account'] = () => ({ ...account, name: 'Casey Elsewhere', version: 5 })
  await press('Discard my changes and reload')
  expect(await screen.findByLabelText(/^Name/)).toHaveValue('Casey Elsewhere')
})

it('changes the password and uses the new token from then on', async () => {
  const current = screen.getByLabelText(/^Current password/)
  const next = screen.getByLabelText(/^New password/)
  expect(current).toHaveAttribute('autocomplete', 'current-password')
  expect(next).toHaveAttribute('autocomplete', 'new-password')
  expect(next).toHaveAccessibleDescription(/10 to 128 characters/)
  server.handlers['POST account/password'] = () => failure(400, 'invalid_input', { fields: { currentPassword: 'This is not your current password.' } })
  await userEvent.type(current, 'wrong')
  await userEvent.type(next, 'another password')
  await press('Change password')
  expect(await screen.findByRole('link', { name: 'This is not your current password.' })).toBeInTheDocument()
  server.handlers['POST account/password'] = () => sessionInfo({ person, csrfToken: 'renewed' })
  await press('Change password')
  await waitFor(() => expect(current).toHaveValue(''))
  expect(next).toHaveValue('')
  server.handlers['POST account/sessions/end-others'] = () => ({ sessions: [device(1, { current: true })] })
  await screen.findAllByText('This device')
  await press('Sign out everywhere else')
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sign out everywhere else' }))
  await waitFor(() => expect(server.sent('POST account/sessions/end-others')[0]?.csrfToken).toBe('renewed'))
})

it('lists devices in the person\'s time zone, marks this one, and signs others out after a question', async () => {
  const table = within(await screen.findByRole('table'))
  await waitFor(() => expect(table.getAllByRole('row')).toHaveLength(3))
  expect(table.getAllByText('This device')).toHaveLength(1)
  expect(table.getAllByText(/Mar 2, 2026, 9:00\sAM/)).toHaveLength(2)
  expect(table.getAllByText(/Mar 2, 2026, 10:30\sAM/)).toHaveLength(2)
  await press('Sign out Firefox on Windows')
  server.handlers['DELETE account/sessions/2'] = () => ({ sessions: [device(1, { current: true })] })
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sign out' }))
  await waitFor(() => expect(table.getAllByRole('row')).toHaveLength(2))
  expect(screen.queryByRole('button', { name: 'Sign out everywhere else' })).not.toBeInTheDocument()
})

it('refuses files that are no pictures or too large before reading them', async () => {
  await expect(shrinkPhoto(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }))).rejects.toThrow(PhotoError)
  await expect(shrinkPhoto(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' }))).rejects.toThrow('larger than 10 MB')
})

it('takes the middle square', () => {
  expect(middleSquare(4000, 3000)).toEqual({ x: 500, y: 0, size: 3000 })
  expect(middleSquare(300, 901)).toEqual({ x: 0, y: 300, size: 300 })
})
