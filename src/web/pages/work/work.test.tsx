import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import type { HomeInfo, InvoiceDetails, TimeEntry, TimeWeek, UnbilledClient } from '../../../shared/work'
import { App } from '../../App'
import { routerFuture, routes } from '../../routes'
import { failure, fakeServer } from '../../test/fakeServer'
import { administrator, person, sessionInfo } from '../../test/session'

const now = '2026-11-25T16:00:00Z'
const entry = (more: Partial<TimeEntry> = {}): TimeEntry => ({
  id: 5, version: 2, projectId: 1, project: 'Pump station', projectCode: 'P', client: 'Fernhollow', taskId: 7, task: 'Design', spentOn: '2026-11-25', minutes: 90,
  timerStartedAt: null, startMinute: null, endMinute: null, notes: 'North run', billable: true, status: 'unsubmitted', locked: null, ...more,
})
const week = (entries: TimeEntry[], running: TimeEntry | null = null): TimeWeek => ({
  person: { id: 7, name: 'Casey' }, own: true, people: [],
  from: '2026-11-21', to: '2026-11-27', today: '2026-11-25', capacityMinutes: 2400, entries, submission: null, running, now,
})

const server = fakeServer()
beforeEach(() => {
  server.session = sessionInfo({ person })
  server.handlers['GET time'] = () => week([entry(), entry({ id: 6, locked: 'approved', status: 'approved', task: 'Meetings', notes: '' })])
  server.handlers['GET time/options'] = () => ({
    projects: [
      { id: 1, name: 'Pump station', code: 'P', client: 'Fernhollow', tasks: [{ id: 7, name: 'Design', billable: true }] },
      { id: 2, name: 'Office', code: '', client: 'Internal', tasks: [{ id: 8, name: 'Paperwork', billable: false }, { id: 9, name: 'Meetings', billable: false }] },
    ],
  })
})

async function open(path: string, title: string) {
  render(<App router={createMemoryRouter(routes, { initialEntries: [path], future: routerFuture })} />)
  await screen.findByRole('heading', { level: 1, name: title })
}
const press = (name: string | RegExp, where = within(document.body)) => userEvent.click(where.getByRole('button', { name }))
const dialog = async () => within(await screen.findByRole('dialog'))

describe('time', () => {
  it('shows the day, what is locked, and the sum of the week', async () => {
    await open('/time', 'Timesheet')
    expect(await screen.findByText('North run')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Design, Pump station' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Meetings, Pump station' })).not.toBeInTheDocument()
    expect(screen.getAllByText('3.00').length).toBeGreaterThan(0)
  })

  it('adds time, choosing the first task of the project', async () => {
    await open('/time', 'Timesheet')
    await screen.findByText('North run')
    await userEvent.click(screen.getAllByRole('button', { name: 'Track time' })[0] as HTMLElement)
    const box = await dialog()
    await userEvent.click(await box.findByRole('combobox', { name: /Project/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Office' }))
    expect(box.getByLabelText(/^Task/)).toHaveValue('8')
    await userEvent.type(box.getByLabelText('Hours'), 'nonsense')
    await press('Add time', box)
    expect(box.getAllByText(/Enter hours such as/).length).toBeGreaterThan(0)
    expect(server.sent('POST time')).toEqual([])
    await userEvent.clear(box.getByLabelText('Hours'))
    await userEvent.type(box.getByLabelText('Hours'), '1.5')
    server.handlers['POST time'] = () => week([entry({ id: 9, notes: 'Added' })])
    await press('Add time', box)
    expect(await screen.findByText('Added')).toBeInTheDocument()
    expect(server.sent('POST time')[0]?.body).toEqual({ projectId: 2, taskId: 8, spentOn: '2026-11-25', minutes: 90, notes: '', start: false, startMinute: null, endMinute: null, personId: null })
  })

  it('starts a timer when the hours are left empty, and shows it in the header', async () => {
    await open('/time?new=1', 'Timesheet')
    const box = await dialog()
    await userEvent.click(await box.findByRole('combobox', { name: /Project/ }))
    await userEvent.click(await screen.findByRole('option', { name: '[P] Pump station' }))
    const running = entry({ id: 9, minutes: 0, timerStartedAt: now })
    server.handlers['POST time'] = () => week([running], running)
    server.handlers['GET time'] = () => week([running], running)
    await press('Start timer', box)
    const header = within(await screen.findByRole('group', { name: 'Running timer' }))
    expect(header.getByText('Design, Pump station')).toBeInTheDocument()
    expect(server.sent('POST time')[0]?.body).toMatchObject({ minutes: 0, start: true })
    server.handlers['POST time/stop'] = () => ({})
    server.handlers['GET time'] = () => week([entry({ id: 9, minutes: 12 })])
    await press('Stop timer', header)
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Running timer' })).not.toBeInTheDocument())
  })

  it('keeps what was typed when someone else changed the entry', async () => {
    await open('/time', 'Timesheet')
    await screen.findByText('North run')
    await press('Edit Design, Pump station')
    const box = await dialog()
    await userEvent.type(await box.findByLabelText('Notes'), ' and south')
    server.handlers['PUT time/5'] = () => failure(409, 'stale', { message: 'Someone else changed this.' })
    await press('Save entry', box)
    expect(await box.findByRole('alert')).toHaveTextContent('Someone else changed this.')
    expect(box.getByLabelText('Notes')).toHaveValue('North run and south')
  })

  it('is deleted only after a confirmation', async () => {
    await open('/time', 'Timesheet')
    await screen.findByText('North run')
    await press('Edit Design, Pump station')
    await press('Delete', await dialog())
    expect(server.sent('POST time/5/delete')).toEqual([])
    server.handlers['POST time/5/delete'] = () => ({})
    server.handlers['GET time'] = () => week([])
    await press('Delete entry', within(await screen.findByRole('dialog', { name: 'Delete this entry?' })))
    expect(await screen.findByText('Nothing tracked on this day.')).toBeInTheDocument()
    expect(server.sent('POST time/5/delete')[0]?.body).toEqual({ version: 2 })
  })

  it('is typed into the week, one change after another', async () => {
    server.handlers['GET time'] = () => week([entry()])
    await open('/time?view=week', 'Timesheet')
    const cell = await screen.findByRole('textbox', { name: 'Design, Pump station, Wednesday, 25 Nov' })
    expect(cell).toHaveValue('1.50')
    await userEvent.clear(cell)
    await userEvent.type(cell, 'x{Enter}')
    expect(cell).toBeInvalid()
    expect(server.sent('PUT time/5')).toEqual([])
    await userEvent.clear(cell)
    await userEvent.type(cell, '6.25')
    server.handlers['PUT time/5'] = () => week([entry({ minutes: 375, version: 3 })])
    server.handlers['POST time'] = () => week([entry({ minutes: 375, version: 3 }), entry({ id: 8, spentOn: '2026-11-26', minutes: 60 })])
    await userEvent.type(cell, '{Enter}')
    await userEvent.type(screen.getByRole('textbox', { name: 'Design, Pump station, Thursday, 26 Nov' }), '1{Enter}')
    await waitFor(() => expect(server.sent('POST time')).toHaveLength(1))
    expect(server.sent('PUT time/5')[0]?.body).toMatchObject({ minutes: 375, notes: 'North run', version: 2 })
    expect(server.sent('POST time')[0]?.body).toEqual({ projectId: 1, taskId: 7, spentOn: '2026-11-26', minutes: 60, notes: '', startMinute: null, endMinute: null, personId: null })
    expect((await screen.findAllByText('7.25')).length).toBeGreaterThan(0)
  })

  it('is handed in after a confirmation, and taken back', async () => {
    await open('/time', 'Timesheet')
    await screen.findByText('North run')
    await press('Submit week for approval')
    server.handlers['POST time/submit'] = () => ({ ...week([entry({ locked: 'period', status: 'submitted' })]), submission: { status: 'submitted', comment: '' } })
    await press('Submit week', await dialog())
    expect(await screen.findByText('Waiting for approval')).toBeInTheDocument()
    expect(server.sent('POST time/submit')[0]?.body).toEqual({ date: '2026-11-21' })
    expect(screen.queryByRole('button', { name: 'Copy from previous day' })).not.toBeInTheDocument()
    server.handlers['POST time/withdraw'] = () => week([entry()])
    await press('Take back')
    expect(await screen.findByRole('button', { name: 'Submit week for approval' })).toBeInTheDocument()
  })

  it('copies the day before', async () => {
    await open('/time', 'Timesheet')
    await screen.findByText('North run')
    await press('Copy from previous day')
    server.handlers['POST time/copy'] = () => week([entry(), entry({ id: 11, task: 'Drafting', taskId: 12, minutes: 0, notes: '' })])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Projects and tasks only' }))
    expect(await screen.findByText('Drafting')).toBeInTheDocument()
    expect(server.sent('POST time/copy')[0]?.body).toEqual({ date: '2026-11-25', withHours: false })
  })
})

describe('home', () => {
  const info = (more: Partial<HomeInfo> = {}): HomeInfo => ({
    today: '2026-11-25', week: [{ day: '2026-11-25', billable: 60, other: 30 }], capacityMinutes: 2400, running: null, now, recent: [entry()], projects: [], ...more,
  })

  it('greets, and goes on with what was done last', async () => {
    server.handlers['GET home'] = () => info()
    await open('/home', 'Home')
    expect(await screen.findByText(/^Good morning, Casey\./)).toHaveTextContent('1.50 of 40.00 hours this week, 67% billable')
    expect(screen.queryByText('Outstanding')).not.toBeInTheDocument()
    server.handlers['POST time/5/start'] = () => ({})
    await press('Start timer for Design, Pump station')
    await waitFor(() => expect(server.sent('POST time/5/start')[0]?.body).toEqual({ version: 2 }))
  })

  it('shows money where the server sends it', async () => {
    server.session = sessionInfo({ person: administrator })
    server.handlers['GET home'] = () =>
      info({ money: { outstanding: [{ currency: 'EUR', amount: 100_00 }, { currency: 'USD', amount: 250_00 }], late: [], drafts: 3, unbilled: [], currency: 'USD', months: [{ month: '2026-11', invoiced: 100, paid: 50 }] } })
    await open('/home', 'Home')
    expect(await screen.findByRole('link', { name: /Outstanding/ })).toHaveTextContent('$250 + €100')
  })
})

describe('invoices', () => {
  const invoice = (more: Partial<InvoiceDetails> = {}): InvoiceDetails => ({
    id: 3, number: 'INV-0003', client: { id: 1, name: 'Tallgrass' }, subject: 'Work', status: 'draft', issuedOn: '2026-11-25', dueOn: '2026-12-25', late: false,
    currency: 'USD', total: 10_000, dueAmount: 10_000, version: 4, company: { name: 'JET Engineering', address: 'Here' }, clientAddress: 'There', purchaseOrder: '',
    notes: '', lines: [{ id: 1, description: 'Design', quantity: 1000, unitPrice: 10_000, amount: 10_000, kind: 'time', minutes: 60 }], subtotal: 10_000,
    discountPercent: null, discountAmount: 0, tax1Name: null, tax1Percent: null, tax1Amount: 0, tax2Name: null, tax2Percent: null, tax2Amount: 0, paidAmount: 0,
    payments: [], canPay: false, ...more,
  })
  beforeEach(() => {
    server.session = sessionInfo({ person: administrator })
    server.handlers['GET invoices/3'] = () => invoice()
  })

  it('says that marking as sent sends nothing', async () => {
    await open('/invoices/3', 'Invoice INV-0003')
    await press('Mark as sent')
    const box = await dialog()
    expect(box.getByText(/JETStream does not send it/)).toBeInTheDocument()
    server.handlers['POST invoices/3/send'] = () => invoice({ status: 'open', canPay: true, version: 5 })
    await press('Mark as sent', box)
    expect(await screen.findByRole('button', { name: 'Record payment' })).toBeInTheDocument()
    expect(server.sent('POST invoices/3/send')[0]?.body).toEqual({ version: 4 })
  })

  it('takes a payment of at most what is due', async () => {
    server.handlers['GET invoices/3'] = () => invoice({ status: 'open', canPay: true })
    await open('/invoices/3', 'Invoice INV-0003')
    await press('Record payment')
    const box = await dialog()
    const amount = box.getByLabelText(/^Amount/)
    expect(amount).toHaveValue('100.00')
    await userEvent.clear(amount)
    await userEvent.type(amount, '100.01')
    await press('Record payment', box)
    expect(box.getAllByText('At most $100.00 is due.').length).toBeGreaterThan(0)
    await userEvent.clear(amount)
    await userEvent.type(amount, '100')
    server.handlers['POST invoices/3/payments'] = () => invoice({ status: 'paid', dueAmount: 0, paidAmount: 10_000 })
    await press('Record payment', box)
    expect(await screen.findByText('Paid in full')).toBeInTheDocument()
    expect(server.sent('POST invoices/3/payments')[0]?.body).toMatchObject({ amount: 10_000, method: 'check' })
  })

  it('is made of the projects that are left chosen', async () => {
    const project = { code: '', minutes: 60, timeAmount: 5000, expenseAmount: 700, entries: 1, withoutRate: 0 }
    const client: UnbilledClient = { id: 1, name: 'Tallgrass', currency: 'USD', total: 11_400, projects: [{ ...project, id: 1, name: 'One' }, { ...project, id: 2, name: 'Two' }] }
    server.handlers['GET invoices/unbilled?from=&to='] = () => ({ clients: [client] })
    await open('/invoices/new', 'New invoice')
    await userEvent.click(await screen.findByRole('button', { name: /Tallgrass/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Two' }))
    expect(screen.getByText('$57.00')).toBeInTheDocument()
    server.handlers['POST invoices'] = () => ({ id: 3 })
    await press('Create draft')
    await screen.findByRole('heading', { level: 1, name: 'Invoice INV-0003' })
    expect(server.sent('POST invoices')[0]?.body).toEqual({ clientId: 1, projectIds: [1], from: null, to: null, grouping: 'task', withExpenses: true, subject: '' })
  })
})
