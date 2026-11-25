import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ApprovalPerson, Approvals, DetailedTime, ExpenseReport, ReportOptions, TimeReport } from '../../../shared/work'
import { App } from '../../App'
import { routerFuture, routes } from '../../routes'
import { fakeServer } from '../../test/fakeServer'
import { administrator, person as member, sessionInfo } from '../../test/session'

const server = fakeServer()
beforeEach(() => {
  server.session = sessionInfo({ person: administrator })
})

function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture })
  render(<App router={router} />)
  return router
}
const press = (name: string | RegExp, where = within(document.body)) => userEvent.click(where.getByRole('button', { name }))
const choose = async (menu: string, item: string) => {
  await press(menu)
  await userEvent.click(screen.getByRole('menuitemradio', { name: item }))
}

const person = (id: number, name: string, more: Partial<ApprovalPerson> = {}): ApprovalPerson => ({
  id, name, photoId: null, department: '', labels: [], missing: true, canSubmit: true, canRemind: true, approved: [], ...more,
})
const approvals = (more: Partial<Approvals> = {}): Approvals => ({
  from: '2026-11-21', to: '2026-11-27', today: '2026-11-25', lock: { through: null, afterDays: null }, canLock: true, canUnlock: true, reminder: { weekday: 5, minute: 1020 },
  people: [person(3, 'Casey', { department: 'Engineering' }), person(4, 'Dana', { canSubmit: false })],
  projects: [{ id: 1, name: 'Pumps', client: { id: 9, name: 'Water' }, tags: [] }],
  lines: [{ personId: 3, projectId: 1, status: 'open', minutes: 2220, billableMinutes: 1260, expenses: [{ currency: 'USD', billable: 17_690, other: 0 }] }],
  pending: [], elsewhere: [], ...more,
})
const week = 'approvals?from=2026-11-21&to=2026-11-27'
const page = '/approvals?from=2026-11-21'

describe('approvals', () => {
  beforeEach(() => {
    server.handlers[`GET ${week}`] = () => approvals()
  })

  it('show who has not submitted, with hours, expenses and a warning for no hours', async () => {
    open(page)
    const casey = within(await screen.findByRole('row', { name: /Casey/ }))
    for (const text of ['37.00', '21.00 (56.76%)', '$176.90']) expect(casey.getByText(text)).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Dana/ })).getByRole('img', { name: 'No hours' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Total time' })).getByText('(57%)')).toBeInTheDocument()
    expect(screen.getByText(/by 5:00pm, Friday/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Time and expenses are still editable' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('remind and submit for people, after a question, and not where there is nothing', async () => {
    open(page)
    await screen.findByRole('row', { name: /Casey/ })
    server.handlers['POST approvals/remind'] = () => ({ reminded: 1 })
    await press('Send reminder to Dana')
    expect(await screen.findByText('Reminded Dana')).toBeInTheDocument()
    expect(server.sent('POST approvals/remind')[0]?.body).toEqual({ personIds: [4], date: '2026-11-21' })
    expect(screen.getByRole('button', { name: 'Force submit for Dana' })).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(screen.getByRole('checkbox', { name: 'Choose everyone' }))
    await press('Force submit all')
    const box = within(await screen.findByRole('dialog', { name: 'Submit for 1 person?' }))
    expect(server.sent('POST approvals/submit')).toEqual([])
    server.handlers['POST approvals/submit'] = () => ({ submitted: 1, refused: [{ person: 'Casey', message: 'Stop the timer first.' }] })
    await press('Force submit', box)
    expect(await screen.findByText('Submitted 1 week')).toBeInTheDocument()
    expect(screen.getByText('Casey: Stop the timer first.')).toBeInTheDocument()
    expect(server.sent('POST approvals/submit')[0]?.body).toEqual({ personIds: [3], from: '2026-11-21', to: '2026-11-27' })
  })

  it('filter, and keep what is chosen in the address', async () => {
    const router = open(page)
    await screen.findByRole('row', { name: /Casey/ })
    await press('Department')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Engineering' }))
    await waitFor(() => expect(screen.queryByRole('row', { name: /Dana/ })).not.toBeInTheDocument())
    expect(router.state.location.search).toContain('departments=Engineering')
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Department: Engineering' })).toHaveFocus()
    await choose('Group by: Person', 'Project')
    expect(await screen.findByRole('row', { name: /Pumps/ })).toBeInTheDocument()
    await press('Clear filters')
    expect(screen.getByRole('button', { name: 'Department' })).toBeInTheDocument()
  })

  it('approve and send back weeks that wait, with their details', async () => {
    server.handlers[`GET ${week}`] = () =>
      approvals({
        lines: [{ personId: 3, projectId: 1, status: 'submitted', minutes: 120, billableMinutes: 120, expenses: [] }],
        pending: [{
          submissionId: 70, person: { id: 3, name: 'Casey', photoId: null }, from: '2026-11-21', to: '2026-11-27', submittedAt: '2026-11-25T16:00:00Z', minutes: 120, billableMinutes: 120, capacityMinutes: 2400, expenses: [],
          entries: [{ id: 1, spentOn: '2026-11-23', client: 'Water', project: 'Pumps', task: 'Design', minutes: 120, billable: true, notes: 'North run', mine: false }], expenseRows: [],
        }],
        elsewhere: [{ from: '2026-11-14', to: '2026-11-20', count: 2 }],
      })
    open(page)
    await screen.findByText('Other weeks wait for approval:', { exact: false })
    await choose('Status: Unsubmitted', 'Pending Approval')
    await press('Show details of Casey')
    expect(screen.getByText('North run')).toBeInTheDocument()
    expect(screen.getByText(/The rest waits for others/)).toBeInTheDocument()
    server.handlers['POST approvals/70/reject'] = () => ({})
    await press('Send back the week of Casey')
    const box = within(await screen.findByRole('dialog'))
    await userEvent.type(box.getByLabelText('What should be changed?'), 'Split it')
    await press('Send back', box)
    await waitFor(() => expect(server.sent('POST approvals/70/reject')[0]?.body).toEqual({ comment: 'Split it' }))
    server.handlers['POST approvals/approve'] = () => ({ approved: 1 })
    await press('Approve the week of Casey')
    await waitFor(() => expect(server.sent('POST approvals/approve')[0]?.body).toEqual({ ids: [70] }))
  })

  it('lock everything up to a date', async () => {
    open(page)
    await userEvent.click(await screen.findByRole('button', { name: 'Apply one-time manual lock' }))
    const box = within(await screen.findByRole('dialog', { name: 'Apply a one-time lock' }))
    server.handlers['POST approvals/lock'] = () => ({})
    server.handlers[`GET ${week}`] = () => approvals({ lock: { through: '2026-11-27', afterDays: null } })
    await press('Lock', box)
    expect(await screen.findByRole('heading', { name: 'Time and expenses are locked' })).toBeInTheDocument()
    expect(server.sent('POST approvals/lock')[0]?.body).toEqual({ through: '2026-11-27' })
    expect(screen.queryByRole('button', { name: 'Apply one-time manual lock' })).not.toBeInTheDocument()
  })
})

const report = (more: Partial<TimeReport> = {}): TimeReport => ({
  from: '2026-11-21', to: '2026-11-27', scope: 'team', minutes: 2400, billableMinutes: 720, showAmounts: true, amounts: [{ currency: 'USD', amount: 207_000 }],
  uninvoiced: [{ currency: 'USD', amount: 224_690 }], byClient: [], byProject: [], byTask: [], departments: ['Engineering', 'Office'],
  byPerson: [
    { id: 5, name: 'Priya', minutes: 2220, billableMinutes: 720, amount: 207_000, currency: 'USD', photoId: null, capacityMinutes: 2400 },
    { id: 3, name: 'Casey', minutes: 180, billableMinutes: 0, amount: 0, currency: 'USD', photoId: null, capacityMinutes: 0 },
  ],
  ...more,
})
const options: ReportOptions = {
  clients: [{ id: 9, name: 'Water', archived: false }, { id: 8, name: 'Old Quarry', archived: true }], projects: [], tasks: [], categories: [{ id: 2, name: 'Meals', archived: false }, { id: 4, name: 'Mileage', archived: false }], tags: [],
  people: [{ id: 3, name: 'Casey', archived: false }, { id: 5, name: 'Priya', archived: false }],
}

describe('the time report', () => {
  const route = 'reports/time?from=2026-11-21&to=2026-11-27'
  const path = '/reports?from=2026-11-21&tab=byPerson'
  beforeEach(() => {
    server.handlers[`GET ${route}`] = () => report()
  })

  it('has utilization, and hours that lead to their list', async () => {
    open(path)
    const row = within(await screen.findByRole('row', { name: /Priya/ }))
    expect(row.getByText('93%')).toBeInTheDocument()
    expect(row.getByRole('link', { name: '37.00 hours of Priya' })).toHaveAttribute('href', '/reports/detailed?from=2026-11-21&to=2026-11-27&people=5')
    expect(screen.getAllByRole('row').map((one) => /Casey|Priya/.exec(one.textContent ?? '')?.[0]).filter(Boolean)).toEqual(['Casey', 'Priya'])
    await press('Hours')
    expect(screen.getAllByRole('row').map((one) => /Casey|Priya/.exec(one.textContent ?? '')?.[0]).filter(Boolean)).toEqual(['Priya', 'Casey'])
    expect(screen.getByText('$2,246.90')).toBeInTheDocument()
  })

  it('asks for a department and for fixed fees', async () => {
    server.handlers[`GET ${route}&department=Office`] = () => report({ minutes: 60, billableMinutes: 0 })
    server.handlers[`GET ${route}&fixed=1&department=Office`] = () => report({ minutes: 120 })
    open(path)
    await screen.findByRole('row', { name: /Priya/ })
    await choose('All departments', 'Office')
    expect((await screen.findAllByText('1.00')).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include Fixed Fee projects' }))
    expect((await screen.findAllByText('2.00')).length).toBeGreaterThan(0)
  })

  it('is saved with what is chosen', async () => {
    open(path)
    await screen.findByRole('row', { name: /Priya/ })
    await press('Save report')
    const box = within(await screen.findByRole('dialog', { name: 'Save report' }))
    await userEvent.type(box.getByLabelText(/^Name/), 'Team')
    server.handlers['POST reports/saved'] = () => ({ reports: [] })
    await press('Save report', box)
    await waitFor(() => expect(server.sent('POST reports/saved')[0]?.body).toEqual({ name: 'Team', path }))
  })

  it('leaves out the tabs and amounts that one may not see', async () => {
    server.session = sessionInfo({ person: member })
    server.handlers[`GET ${route}`] = () => report({ scope: 'own', showAmounts: false, amounts: [], uninvoiced: [], departments: [] })
    open('/reports?from=2026-11-21')
    await screen.findByText('40.00')
    expect(within(screen.getByRole('navigation', { name: 'Reports' })).getAllByRole('link').map(({ textContent }) => textContent)).toEqual(['Time', 'Saved reports'])
    expect(screen.queryByRole('checkbox', { name: 'Include Fixed Fee projects' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Teammates' })).not.toBeInTheDocument()
  })
})

describe('detailed reports', () => {
  it('of expenses are filtered by what is chosen, and say it', async () => {
    const row = {
      id: 1, spentOn: '2026-07-20', clientId: 9, client: 'Water', projectId: 1, project: 'Pumps', categoryId: 2, category: 'Meals', personId: 3, person: 'Casey', tagIds: [], notes: '', amount: 100_000, currency: 'USD', billable: true,
      invoiced: false, reimbursementStatus: 'none',
    }
    server.handlers['GET reports/expenses?from=2026-07-18&to=2026-07-24'] = (): ExpenseReport => ({ options, rows: [row, { ...row, id: 2, personId: 5, person: 'Priya', categoryId: 4, category: 'Mileage', amount: 34_062, billable: false }] })
    const router = open('/reports/expenses?from=2026-07-18&to=2026-07-24')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Detailed expense report: 07/18/2026 – 07/24/2026')
    expect(await screen.findByText('$1,340.62')).toBeInTheDocument()
    expect(screen.getByLabelText('Timeframe')).toHaveValue('custom')
    const chosen = within(screen.getByRole('list', { name: 'Chosen' }))
    for (const text of ['All clients', 'All projects', 'All categories', 'All teammates', 'All tags']) expect(chosen.getByText(text)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('combobox', { name: 'Clients' }))
    expect(screen.queryByRole('option', { name: 'Old Quarry (archived)' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include archived items in filters' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Clients' }))
    expect(screen.getByRole('option', { name: 'Old Quarry (archived)' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('combobox', { name: 'Teammates' }))
    await userEvent.click(screen.getByRole('option', { name: 'Priya' }))
    expect(screen.queryByText('$1,340.62')).not.toBeInTheDocument()
    expect(chosen.getByText('Priya')).toBeInTheDocument()
    expect(router.state.location.search).toContain('people=5')
    await press('Hide filters')
    expect(screen.queryByRole('combobox', { name: 'Teammates' })).not.toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /Mileage/ })).toBeInTheDocument()
  })

  it('of time open with what a link chose', async () => {
    const row: DetailedTime['rows'][number] = {
      id: 1, spentOn: '2026-11-23', clientId: 9, client: 'Water', projectId: 1, project: 'Pumps', taskId: 7, task: 'Design', personId: 3, person: 'Casey', tagIds: [], notes: '', minutes: 90, billable: true, amount: 100, currency: 'USD',
      invoiced: false, status: 'unsubmitted',
    }
    server.handlers['GET reports/detailed?from=2026-11-21&to=2026-11-27'] = (): DetailedTime => ({ showAmounts: true, scope: 'team', options, rows: [row, { ...row, id: 2, personId: 5, person: 'Priya', minutes: 600 }] })
    open('/reports/detailed?from=2026-11-21&to=2026-11-27&people=3')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Detailed time report')
    expect((await screen.findAllByText('1.50')).length).toBeGreaterThan(0)
    expect(screen.queryByText('10.00')).not.toBeInTheDocument()
  })
})
