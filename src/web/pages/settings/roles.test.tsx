import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it } from 'vitest'
import type { RoleDetails, RoleSummary } from '../../../shared/api'
import { App } from '../../App'
import { routerFuture, routes } from '../../routes'
import { fakeServer } from '../../test/fakeServer'
import { administrator, sessionInfo } from '../../test/session'

const summary: RoleSummary = { id: 20, key: null, builtIn: false, name: 'Scheduler', description: 'Plans', people: 2 }
const role = (more: Partial<RoleDetails> = {}): RoleDetails => ({ ...summary, grants: { 'schedule.view': 'all', 'schedule.edit': 'all' }, version: 3, invites: 0, refusal: null, ...more })
const member: RoleSummary = { id: 13, key: 'member', builtIn: true, name: 'Member', description: 'Own work', people: 5 }

const server = fakeServer()
beforeEach(() => {
  server.session = sessionInfo({ person: administrator })
  server.handlers['GET roles'] = () => ({ roles: [member, summary] })
  server.handlers['GET roles/20'] = () => role()
})

async function open(path: string, title: string) {
  render(<App router={createMemoryRouter(routes, { initialEntries: [path], future: routerFuture })} />)
  await screen.findByRole('heading', { level: 1, name: title })
}
const press = (name: string, where = within(document.body)) => userEvent.click(where.getByRole('button', { name }))

it('lists roles with the number of people', async () => {
  await open('/settings/roles', 'Roles')
  const cells = within(await screen.findByRole('row', { name: /Scheduler/ }))
  expect(cells.getByText('Custom')).toBeInTheDocument()
  expect(cells.getByText('2')).toBeInTheDocument()
})

it('makes a role, choosing what a permission needs', async () => {
  await open('/settings/roles/new', 'New role')
  await userEvent.type(screen.getByLabelText(/^Name/), 'Planner')
  await userEvent.selectOptions(screen.getByLabelText("Plan others' schedule"), 'All')
  expect(screen.getByLabelText("Others' schedule")).toHaveValue('all')
  expect(screen.getByText(/Also chosen/)).toBeInTheDocument()
  server.handlers['POST roles'] = () => role({ id: 21 })
  await press('Create role')
  await waitFor(() => expect(server.sent('POST roles')[0]?.body).toEqual({ name: 'Planner', description: '', grants: { 'schedule.view': 'all', 'schedule.edit': 'all' } }))
})

it('changes a held role only after saying who gains and loses what', async () => {
  await open('/settings/roles/20', 'Scheduler')
  await userEvent.selectOptions(screen.getByLabelText("Others' schedule"), 'None')
  expect(screen.getByLabelText("Plan others' schedule")).toHaveValue('none')
  await press('Save role')
  const box = within(await screen.findByRole('dialog', { name: 'Change the role of 2 people?' }))
  expect(box.getByText('They lose:')).toBeInTheDocument()
  expect(server.sent('PUT roles/20')).toEqual([])
  server.handlers['PUT roles/20'] = () => role({ grants: {} })
  await press('Save role', box)
  await waitFor(() => expect(server.sent('PUT roles/20')[0]?.body).toEqual({ name: 'Scheduler', description: 'Plans', grants: {}, version: 3 }))
})

it('is deleted only with another role for who has it', async () => {
  await open('/settings/roles/20', 'Scheduler')
  await press('Delete')
  const box = within(await screen.findByRole('dialog', { name: 'Delete Scheduler?' }))
  await press('Delete role', box)
  expect(server.sent('POST roles/20/delete')).toEqual([])
  await userEvent.selectOptions(await box.findByLabelText('Other role'), 'Member')
  server.handlers['POST roles/20/delete'] = () => ({ roles: [member] })
  await press('Delete role', box)
  await waitFor(() => expect(server.sent('POST roles/20/delete')[0]?.body).toEqual({ version: 3, replacementId: 13 }))
})

it('shows a built-in role read-only, which can be duplicated', async () => {
  server.handlers['GET roles/13'] = () => ({ ...member, grants: {}, version: 1, invites: 0, refusal: 'Built-in roles cannot be changed.' })
  await open('/settings/roles/13', 'Member')
  expect(screen.getByText('Built-in roles cannot be changed.')).toBeInTheDocument()
  expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Duplicate' })).toHaveAttribute('href', '/settings/roles/new?from=13')
})
