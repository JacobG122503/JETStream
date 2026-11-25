import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AssignmentClient, InviteRow, JoinRequest, PersonAccessDetails, PersonDetails } from '../../../shared/api'
import { everything, managerGrants } from '../../../shared/permissions'
import { App } from '../../App'
import { routerFuture, routes } from '../../routes'
import { failure, fakeServer } from '../../test/fakeServer'
import { administrator, person, sessionInfo } from '../../test/session'
import { allProjectsState, choiceOf, noChoice, removedClients, toggleClient, toggleProjects } from './assignmentChoice'

const server = fakeServer()
beforeEach(() => {
  server.session = sessionInfo({ person: administrator })
  server.handlers['GET people'] = () => ({ people: [row(3, 'Priya'), row(4, 'Marcus')] })
  server.handlers['GET requests'] = () => ({ enabled: true, requests: [request] })
  server.handlers['GET help-requests'] = () => ({ requests: [] })
  server.handlers['GET people/options'] = () => ({ roles, clients: clients() })
  server.handlers['GET invites'] = () => ({ invites: [] })
})

const roles = [{ id: 11, key: 'administrator', name: 'Administrator', allowed: true }, { id: 12, key: 'manager', name: 'Manager', allowed: true }, { id: 13, key: 'member', name: 'Member', allowed: true }]
const row = (id: number, name: string) =>
  ({ id, name, email: `${name.toLowerCase()}@jet.example`, role: 'Member', status: 'active', signIn: 'none', photoId: null }) as const
const request: JoinRequest = { id: 9, name: 'Noah', email: 'noah@client.example', requestedAt: '2026-03-02T15:00:00Z' }
const project = (id: number, more: object = {}) => ({ id, name: `Project ${id}`, code: '', archived: false, assigned: false, ...more })
const clients = (): AssignmentClient[] => [
  { id: 1, name: 'Tallgrass', archived: false, assigned: false, projects: [project(1), project(2)] },
  { id: 2, name: 'Kestrel', archived: false, assigned: false, projects: [] },
]
const invite = (more: Partial<InviteRow>): InviteRow => ({
  id: 5, name: 'Ivy', email: 'ivy@client.example', role: 'Member', status: 'open', invitedBy: 'Avery', createdAt: '2026-03-02T15:00:00Z',
  expiresAt: '2026-03-09T15:00:00Z', acceptedAt: null, revokedAt: null, ...more,
})

async function open(path: string, heading: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture })
  render(<App router={router} />)
  await screen.findByRole('heading', { level: 1, name: heading })
  return router
}
const dialog = () => screen.findByRole('dialog')
const press = (name: string | RegExp, within_: Pick<typeof screen, 'getByRole'> = screen) =>
  userEvent.click(within_.getByRole('button', { name }))

it.each([['/team', 'Team'], ['/team/3', 'Person']])('%s is not for everyone', async (path, heading) => {
  server.session = sessionInfo({ person })
  await open(path, heading)
  expect(screen.getByRole('heading', { level: 2, name: 'You do not have access to this page' })).toBeInTheDocument()
  expect(server.calls.map(({ route }) => route).filter((route) => route !== 'session' && route !== 'time')).toEqual([])
})

describe('team', () => {
  it('has four tabs, with how many wait, and a search', async () => {
    await open('/team', 'Team')
    await screen.findByRole('tab', { name: 'Requests (1)' })
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['People', 'Requests (1)', 'Invites', 'Help requests'])
    expect(await screen.findByRole('link', { name: 'Marcus' })).toHaveAttribute('href', '/team/4')
    await userEvent.type(screen.getByRole('searchbox'), 'priya@')
    expect(screen.queryByRole('link', { name: 'Marcus' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Priya' })).toBeInTheDocument()
  })

  it('keeps the tab in the address', async () => {
    const router = await open('/team?tab=invites', 'Team')
    expect(await screen.findByText('No invites')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Help requests' }))
    expect(router.state.location.search).toBe('?tab=help')
    expect(await screen.findByText('No help requests')).toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    server.handlers['GET people'] = () => failure(500, 'internal_error', { message: 'Something went wrong' })
    await open('/team', 'Team')
    await press('Retry', within(await screen.findByRole('table')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
  })

  it('approves with a role and assignments, Member being chosen beforehand', async () => {
    await open('/team?tab=requests', 'Team')
    expect(await screen.findByText(/not verified/)).toBeInTheDocument()
    await press('Approve Noah')
    const box = within(await dialog())
    expect(await box.findByLabelText(/^Role/)).toHaveValue('13')
    await userEvent.click(box.getByRole('checkbox', { name: 'Project 2' }))
    expect(box.getByRole('checkbox', { name: 'Tallgrass' })).toBeChecked()
    expect(box.getByRole('checkbox', { name: 'Project 1' })).not.toBeChecked()
    server.handlers['POST requests/9/approve'] = () => ({ enabled: true, requests: [] })
    await press('Approve', box)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(server.sent('POST requests/9/approve')[0]?.body).toEqual({ roleId: 13, clientIds: [1], projectIds: [2] })
    expect(await screen.findByText('No requests')).toBeInTheDocument()
  })

  it.each(['Approve', 'Decline'])('says when someone else was quicker: %s', async (action) => {
    await open('/team?tab=requests', 'Team')
    const taken = () => failure(409, 'already_handled', { message: 'This request was already handled.' })
    server.handlers['POST requests/9/approve'] = taken
    server.handlers['POST requests/9/decline'] = taken
    await screen.findByText('noah@client.example')
    await press(`${action} Noah`)
    const box = within(await dialog())
    if (action === 'Approve') await box.findByLabelText(/^Role/)
    server.handlers['GET requests'] = () => ({ enabled: true, requests: [] })
    await press(action === 'Approve' ? 'Approve' : 'Decline request', box)
    expect(await screen.findByText('This request was already handled.')).toBeInTheDocument()
    expect(await screen.findByText('No requests')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('switches requests off', async () => {
    server.handlers['PUT requests/enabled'] = ({ body }) => ({ ...(body as object), requests: [] })
    await open('/team?tab=requests', 'Team')
    const control = await screen.findByRole('switch')
    await userEvent.click(control)
    await waitFor(() => expect(control).not.toBeChecked())
    expect(server.sent('PUT requests/enabled')[0]?.body).toEqual({ enabled: false })
  })

  it('invites and shows the link once', async () => {
    userEvent.setup() // Gives the test a clipboard.
    await open('/team?tab=invites', 'Team')
    await press('Invite someone')
    const box = within(await dialog())
    await userEvent.type(box.getByLabelText(/^Name/), 'Ivy')
    await userEvent.type(box.getByLabelText(/^Email/), 'ivy@client.example')
    await box.findByLabelText(/^Role/)
    server.handlers['POST invites'] = () => failure(409, 'open_invite', { message: 'This address already has an open invite.' })
    await press('Make invite link', box)
    expect(await box.findByRole('alert')).toHaveTextContent('already has an open invite')
    server.handlers['POST invites'] = () => ({ link: 'https://x.example/invite#abc', expiresAt: '2026-03-09T15:00:00Z', emailed: false })
    server.handlers['GET invites'] = () => ({ invites: [invite({})] })
    await press('Make invite link', box)
    const shown = within(await screen.findByRole('dialog', { name: 'Invite link' }))
    expect(shown.getByLabelText('Invite link')).toHaveValue('https://x.example/invite#abc')
    expect(shown.getByText(/nothing was sent/)).toBeInTheDocument()
    await press('Copy', shown)
    expect(await shown.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('https://x.example/invite#abc')
    await press('Done', shown)
    expect(document.body.innerHTML).not.toContain('invite#abc')
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('offers a new link and revoking only for invites that are not over', async () => {
    const over = [invite({ id: 1, status: 'accepted', acceptedAt: '2026-03-03T15:00:00Z' }), invite({ id: 2, status: 'revoked', revokedAt: '2026-03-03T15:00:00Z' })]
    server.handlers['GET invites'] = () => ({ invites: [invite({ id: 5 }), invite({ id: 6, status: 'expired' }), invite({ id: 7, status: 'void' }), ...over] })
    await open('/team?tab=invites', 'Team')
    expect(await screen.findAllByRole('button', { name: 'New link for Ivy' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Revoke the invite of Ivy' })).toHaveLength(3)
    for (const text of ['Open', 'Expired', 'Accepted', 'Revoked']) expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('makes a reset link for someone who asked for help', async () => {
    server.handlers['GET help-requests'] = () => ({
      requests: [{ id: 1, personId: 3, name: 'Priya', email: 'priya@jet.example', requestedAt: '2026-03-02T15:00:00Z', hasPassword: true }],
    })
    server.handlers['POST people/3/reset-link'] = () => ({ link: 'https://x.example/reset-password#abc', expiresAt: '2026-03-02T16:00:00Z', emailed: false })
    await open('/team?tab=help', 'Team')
    await userEvent.click(await screen.findByRole('button', { name: 'Make a reset link for Priya' }))
    await press('Make reset link', within(await dialog()))
    const shown = within(await screen.findByRole('dialog', { name: 'Reset link' }))
    expect(shown.getByText('Make sure who is asking')).toBeInTheDocument()
    expect(shown.getByLabelText('Reset link')).toHaveValue('https://x.example/reset-password#abc')
  })
})

const access = (more: Partial<PersonAccessDetails> = {}): PersonAccessDetails => ({
  state: 'a', editable: 'all', reason: null, roleId: 13, extras: [], refusedExtras: [], managedPeople: [],
  projects: [{ id: 1, name: 'Project 1', client: 'Tallgrass', archived: false, isManager: false }],
  roles: [
    { id: 11, key: 'administrator', name: 'Administrator', builtIn: true, grants: everything(), refusal: null },
    { id: 12, key: 'manager', name: 'Manager', builtIn: true, grants: managerGrants(), refusal: null },
    { id: 13, key: 'member', name: 'Member', builtIn: true, grants: {}, refusal: null },
  ],
  people: [{ id: 4, name: 'Marcus', active: true }],
  ...more,
})

describe('the access of a person', () => {
  beforeEach(() => {
    server.handlers['GET people/3'] = () => ({ ...row(3, 'Priya'), timeZone: 'America/Chicago' })
    server.handlers['GET people/3/access'] = () => access()
  })

  it('is given as a role with extras, which bring what they need, and projects to manage', async () => {
    await open('/team/3', 'Priya')
    await userEvent.selectOptions(await screen.findByLabelText('Role'), 'Manager')
    const invoices = screen.getByRole('checkbox', { name: 'Create, edit, send, delete invoices' })
    expect(invoices).not.toBeChecked()
    await userEvent.click(invoices)
    expect(screen.getByRole('checkbox', { name: 'Billable rates, billable amounts, fee budgets' })).toBeChecked()
    expect(screen.getByText(/Also switched on/)).toHaveTextContent('Billable rates')
    await userEvent.click(screen.getByRole('switch', { name: 'Project 1 (Tallgrass)' }))
    expect(screen.getByText('Manages these projects: Project 1.')).toBeInTheDocument()
    server.handlers['PUT people/3/access'] = () => access({ state: 'b', roleId: 12, extras: ['billable.view', 'invoices.manage'] })
    await press('Save access')
    await waitFor(() => expect(server.sent('PUT people/3/access')).toHaveLength(1))
    expect(server.sent('PUT people/3/access')[0]?.body).toEqual({
      roleId: 12, extras: ['billable.view', 'invoices.manage'], managedPersonIds: [], managedProjectIds: [1], state: 'a',
    })
  })

  it('loses extras with the role only after a confirmation that names them', async () => {
    server.handlers['GET people/3/access'] = () => access({ roleId: 12, extras: ['time.approve'] })
    await open('/team/3', 'Priya')
    await userEvent.selectOptions(await screen.findByLabelText('Role'), 'Member')
    await press('Save access')
    const box = within(await dialog())
    expect(box.getByText('Approve, reject, withdraw approval of time and expenses')).toBeInTheDocument()
    expect(server.sent('PUT people/3/access')).toEqual([])
    server.handlers['PUT people/3/access'] = () => access({ state: 'b' })
    await press('Remove and save', box)
    await waitFor(() => expect(server.sent('PUT people/3/access')[0]?.body).toMatchObject({ roleId: 13, extras: [] }))
  })

  it('is shown read-only with the reason when it may not be changed', async () => {
    server.handlers['GET people/3/access'] = () => access({ editable: 'none', reason: 'You cannot change your own access.' })
    await open('/team/3', 'Priya')
    expect(await screen.findByText('You cannot change your own access.')).toBeInTheDocument()
    expect(screen.getByLabelText('Role')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save access' })).not.toBeInTheDocument()
  })
})

describe('a person', () => {
  const details = (more: Partial<PersonDetails> = {}): PersonDetails => ({
    ...row(3, 'Priya'), timeZone: 'America/Chicago', state: 'one',
    clients: [
      { id: 1, name: 'Tallgrass', archived: false, assigned: true, projects: [project(1, { assigned: true }), project(2), project(3, { assigned: true, archived: true })] },
      { id: 2, name: 'Kestrel', archived: false, assigned: false, projects: [] },
      { id: 4, name: 'Old Quarry', archived: true, assigned: true, projects: [project(5, { assigned: true, archived: true })] },
    ],
    ...more,
  })
  beforeEach(() => {
    server.handlers['GET people/3/access'] = () => access()
    server.handlers['GET people/3'] = () => details()
  })

  it('is assigned; archived assignments are shown read-only', async () => {
    await open('/team/3', 'Priya')
    expect(screen.getByRole('checkbox', { name: 'Old Quarry (archived)' })).toBeDisabled()
    expect(screen.getAllByText('Archived, stays assigned')).toHaveLength(2)
    await userEvent.click(screen.getByRole('checkbox', { name: 'All projects of Tallgrass' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Kestrel' }))
    server.handlers['PUT people/3/assignments'] = () => details({ state: 'two' })
    await press('Save assignments')
    await waitFor(() => expect(server.sent('PUT people/3/assignments')).toHaveLength(1))
    expect(server.sent('PUT people/3/assignments')[0]?.body).toEqual({ clientIds: [1, 2], projectIds: [1, 2], state: 'one' })
  })

  it('loses a client only after a confirmation that names the projects', async () => {
    await open('/team/3', 'Priya')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tallgrass' }))
    expect(screen.getByRole('checkbox', { name: 'Project 1' })).not.toBeChecked()
    await press('Save assignments')
    const box = within(await dialog())
    expect(box.getByText('Tallgrass: Project 1, Project 3')).toBeInTheDocument()
    await press('Cancel', box)
    expect(server.sent('PUT people/3/assignments')).toEqual([])
    server.handlers['PUT people/3/assignments'] = () => details({ clients: [] })
    await press('Save assignments')
    await press('Remove and save', within(await dialog()))
    await waitFor(() => expect(server.sent('PUT people/3/assignments')[0]?.body).toEqual({ clientIds: [], projectIds: [], state: 'one' }))
  })

  it('keeps the choice when someone else changed it, and offers to reload', async () => {
    await open('/team/3', 'Priya')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Kestrel' }))
    server.handlers['PUT people/3/assignments'] = () => failure(409, 'stale', { message: 'Someone else changed this.' })
    await press('Save assignments')
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed this.')
    expect(screen.getByRole('checkbox', { name: 'Kestrel' })).toBeChecked()
    await press('Discard my changes and reload')
    expect(await screen.findByRole('checkbox', { name: 'Kestrel' })).not.toBeChecked()
  })

  it('cannot be assigned unless active', async () => {
    server.handlers['GET people/3'] = () => details({ status: 'archived' })
    await open('/team/3', 'Priya')
    expect(screen.getByText('Only active people can be assigned.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save assignments' })).not.toBeInTheDocument()
  })
})

describe('choosing assignments', () => {
  const [tallgrass, kestrel] = clients() as [AssignmentClient, AssignmentClient]

  it('a project brings its client, a client no project, and leaving a client out leaves out its projects', () => {
    expect(toggleClient(noChoice, tallgrass, true)).toEqual({ clientIds: [1], projectIds: [] })
    const one = toggleProjects(noChoice, tallgrass, [2], true)
    expect(one).toEqual({ clientIds: [1], projectIds: [2] })
    expect(toggleProjects(one, tallgrass, [2], false)).toEqual({ clientIds: [1], projectIds: [] })
    expect(toggleClient({ clientIds: [1, 2], projectIds: [1, 2] }, tallgrass, false)).toEqual({ clientIds: [2], projectIds: [] })
    expect([noChoice, one, toggleProjects(one, tallgrass, [1, 2], true)].map((choice) => allProjectsState(choice, tallgrass))).toEqual(['none', 'some', 'all'])
    expect(allProjectsState(noChoice, kestrel)).toBe('none')
  })

  it('knows what is assigned and what would go', () => {
    const list = [{ ...tallgrass, assigned: true, projects: [project(1, { assigned: true }), project(2)] }, kestrel]
    expect(choiceOf(list)).toEqual({ clientIds: [1], projectIds: [1] })
    expect(removedClients(list, noChoice)).toEqual([{ name: 'Tallgrass', projects: ['Project 1'] }])
    expect(removedClients(list, choiceOf(list))).toEqual([])
  })
})
