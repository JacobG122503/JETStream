// Invoices, estimates, recurring invoices, retainers and what clients see, over the demo company.
import { createHmac } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  ClientEstimate, ClientInvoice, DocumentOptions, EstimateDetails, InvoiceDetails, MessageInput, RecurringDetails, RetainerDetails, Statement,
} from '../../shared/billing'
import { ageing, nextOccurrence, occurrence, remindersDue } from '../../shared/calc'
import type { UnbilledClient } from '../../shared/work'
import type { createApp } from '../app'
import { createContext } from '../app'
import type { Database } from '../db'
import { clients, invoices, payments, recurringInvoices } from '../db/schema'
import { demoPassword } from '../demo/accounts'
import { seedDemo } from '../demo'
import { simulatedPayments, stripePayments } from '../payments/provider'
import { browser, type Browser, signedIn, standInSender, testApp, testClock } from '../testing/apiClient'
import { createTestDatabase } from '../testing/testDatabase'
import { makeDueInvoices } from './recurring'

const today = '2026-11-24'
const clock = testClock('2026-11-24T16:00:00Z')
const { sender, messages } = standInSender()
let database: Database
let app: ReturnType<typeof createApp>
let admin: Browser
let lead: Browser
let stranger: Browser
let options: DocumentOptions
beforeAll(async () => {
  database = await createTestDatabase()
  await seedDemo(database.db, { today })
  app = testApp({ db: database.db, now: clock.now, email: sender, payments: simulatedPayments })
  admin = await signedIn(app, 'admin@jet.demo', demoPassword)
  lead = await signedIn(app, 'lead@jet.demo', demoPassword)
  stranger = browser(app)
  options = await get<DocumentOptions>(admin, '/documents/options')
}, 60_000)
afterAll(() => database.close())

async function get<T>(client: Browser, path: string): Promise<T> {
  const response = await client.get(path)
  expect(response.status, path).toBe(200)
  return response.body as T
}
const codeOf = (response: { status: number; body: unknown }) => [response.status, (response.body as { error?: { code: string } }).error?.code]
const client = (name = 'Tallgrass') => options.clients.find((one) => one.name.startsWith(name)) ?? options.clients[0]
const line = (more: object = {}) => ({ id: null, description: 'Study', quantity: 2000, unitPrice: 50_000, projectId: null, categoryId: null, tax1: false, tax2: false, ...more })
const input = (more: object = {}) => ({
  clientId: client()?.id, number: '', subject: 'Work', purchaseOrder: '', notes: '', discountPercent: null, tax1Name: null, tax1Percent: null, tax2Name: null, tax2Percent: null,
  issuedOn: today, paymentTerms: 'net_30', dueOn: today, lines: [line()], ...more,
})
async function make(more: object = {}): Promise<InvoiceDetails> {
  const made = await admin.post('/invoices/free', input(more))
  expect(made.status).toBe(201)
  return get<InvoiceDetails>(admin, `/invoices/${(made.body as { id: number }).id}`)
}
const post = async (path: string, body: object = {}) => (await admin.post(path, body)).body as InvoiceDetails
const open = async (more: object = {}) => {
  const { id, version } = await make(more)
  return post(`/invoices/${id}/send`, { version })
}
const pay = (amount: number) => ({ amount, paidOn: today, method: 'check', reference: '', notes: '' })
const message = (more: Partial<MessageInput> = {}): MessageInput => ({ kind: 'sent', recipients: [{ name: 'Pat Example', email: 'pat@client.example' }], subject: 'Invoice', body: 'See {link}', ...more })
/** The token of the last link that was sent. */
const sentToken = () => messages.at(-1)?.link?.split('#')[1]

describe('dates and ageing', () => {
  it('repeats from the start, so that the end of a month stays it', () => {
    expect([0, 1, 2, 3].map((index) => occurrence('2026-01-31', 'monthly', 1, index))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(nextOccurrence('2026-01-31', 'monthly', 1, '2026-02-28')).toBe('2026-03-31')
    expect(nextOccurrence('2026-01-05', 'weekly', 2, '2026-01-05')).toBe('2026-01-19')
    expect(nextOccurrence('2024-02-29', 'yearly', 1, '2024-02-29')).toBe('2025-02-28')
  })

  it('sorts what is due by how late it is', () => {
    const due = (dueOn: string, dueAmount: number) => ({ dueOn, dueAmount })
    expect(ageing([due('2026-11-24', 1), due('2026-11-23', 2), due('2026-10-25', 4), due('2026-10-24', 8), due('2026-08-26', 16), due('2026-08-25', 32)], today)).toEqual([1, 6, 8, 16, 32])
    expect(remindersDue('2026-11-01', [30, 3, 14], today)).toEqual(['2026-11-04', '2026-11-15'])
  })
})

describe('an invoice of typed lines', () => {
  it('is made, changed with a check for other changes, and duplicated', async () => {
    const made = await make({ tax1Name: 'Tax', tax1Percent: 10_000, discountPercent: 50_000, lines: [line({ tax1: true }), line({ unitPrice: -10_000, quantity: 1000 })] })
    // 100,000 and -10,000, half of it off; 10% of half of 100,000.
    expect(made).toMatchObject({ status: 'draft', subtotal: 90_000, discountAmount: 45_000, tax1Amount: 5000, total: 50_000, dueOn: '2026-12-24' })
    const [first, second] = made.lines
    const changed = await admin.put(`/invoices/${made.id}`, input({ number: 'X-1', lines: [line({ id: second?.id, unitPrice: 100 }), line({ id: first?.id, description: 'New' })], version: made.version }))
    expect(changed.body).toMatchObject({ number: 'X-1', total: 100_200, lines: [{ unitPrice: 100 }, { description: 'New' }] })
    expect(codeOf(await admin.put(`/invoices/${made.id}`, input({ version: made.version })))).toEqual([409, 'stale'])
    expect(codeOf(await admin.post('/invoices/free', input({ number: 'X-1' })))).toEqual([400, 'invalid_input'])
    expect(codeOf(await admin.post('/invoices/free', input({ number: made.number })))).toEqual([400, 'invalid_input'])
    expect(codeOf(await admin.post('/invoices/free', input({ tax1Name: 'Tax' })))).toEqual([400, 'invalid_input'])
    expect(codeOf(await admin.post('/invoices/free', input({ lines: [line({ unitPrice: -1 })] })))).toEqual([409, 'total_too_low'])
    const other = options.clients.find(({ id, projects }) => id !== client()?.id && projects.length > 0)?.projects[0]?.id
    expect(codeOf(await admin.post('/invoices/free', input({ lines: [line({ projectId: other })] })))).toEqual([400, 'invalid_input'])
    const copy = await post(`/invoices/${made.id}/duplicate`)
    expect(await get(admin, `/invoices/${copy.id}`)).toMatchObject({ status: 'draft', total: 100_200, issuedOn: today })
    for (const [method, path] of [['get', '/documents/options'], ['post', '/invoices/free'], ['get', `/invoices/${made.id}`]] as const) expect(codeOf(await lead[method](path))).toEqual([403, 'forbidden'])
  })

  it('keeps its hours when changed, and frees those of a line that is taken away', async () => {
    const unbilled = (await get<{ clients: UnbilledClient[] }>(admin, '/invoices/unbilled')).clients[0]
    const { id } = await post('/invoices', { clientId: unbilled?.id, projectIds: unbilled?.projects.map((project) => project.id), from: null, to: null, grouping: 'task', withExpenses: true, subject: '' })
    const made = await get<InvoiceDetails>(admin, `/invoices/${id}`)
    const typed = made.lines.map(({ kind: _kind, minutes: _minutes, amount: _amount, ...rest }) => ({ ...rest, quantity: 1, unitPrice: 1 }))
    const same = (await admin.put(`/invoices/${id}`, { ...input({ lines: typed, version: made.version }), clientId: unbilled?.id })).body as InvoiceDetails
    expect(same.subtotal).toBe(made.subtotal)
    const fewer = (await admin.put(`/invoices/${id}`, { ...input({ lines: typed.slice(1), version: same.version }), clientId: unbilled?.id })).body as InvoiceDetails
    expect(fewer.subtotal).toBe(made.subtotal - (made.lines[0]?.amount ?? 0))
    const again = (await get<{ clients: UnbilledClient[] }>(admin, '/invoices/unbilled')).clients.find((one) => one.id === unbilled?.id)
    expect(again?.total).toBe(made.lines[0]?.amount)
    const added = await admin.post(`/invoices/${id}/add`, { projectIds: again?.projects.map((project) => project.id), from: null, to: null, grouping: 'task', withExpenses: true, version: fewer.version })
    expect((added.body as InvoiceDetails).subtotal).toBe(made.subtotal)
    expect((await admin.post(`/invoices/${id}/delete`, { version: (added.body as InvoiceDetails).version })).status).toBe(200)
  })

  it('cannot become less than what was paid, and one of nothing is settled once it is sent', async () => {
    const invoice = await open()
    const paid = await post(`/invoices/${invoice.id}/payments`, pay(60_000))
    expect(paid).toMatchObject({ status: 'open', dueAmount: 40_000 })
    const [first] = paid.lines
    expect(codeOf(await admin.put(`/invoices/${invoice.id}`, input({ lines: [line({ id: first?.id, quantity: 1000 })], version: paid.version })))).toEqual([409, 'total_too_low'])
    expect(await open({ lines: [line({ unitPrice: 0 })] })).toMatchObject({ status: 'paid', total: 0 })
    const empty = await make({ lines: [] })
    expect(codeOf(await admin.post(`/invoices/${empty.id}/send`, { version: empty.version }))).toEqual([409, 'no_lines'])
  })

  it('is not made for an archived client', async () => {
    const [old] = await database.db.select().from(clients).where(eq(clients.archivedAt, clients.archivedAt))
    expect(codeOf(await admin.post('/invoices/free', input({ clientId: old?.id })))).toEqual([409, 'client_archived'])
  })
})

describe('money', () => {
  it('is refunded and taken back, which opens the invoice again', async () => {
    const invoice = await open()
    const paid = await post(`/invoices/${invoice.id}/payments`, pay(100_000))
    expect(paid.status).toBe('paid')
    const paymentId = paid.payments[0]?.id
    const refund = { paymentId, amount: 30_000, refundedOn: today, reason: 'Too much' }
    expect(codeOf(await admin.post(`/invoices/${invoice.id}/refund`, { ...refund, amount: 100_001 }))).toEqual([409, 'refund_exceeds_payment'])
    expect(await post(`/invoices/${invoice.id}/refund`, refund)).toMatchObject({ status: 'open', dueAmount: 30_000, payments: [{ refunds: [{ amount: 30_000 }] }] })
    const other = await open()
    expect(codeOf(await admin.post(`/invoices/${other.id}/remove-payment`, { paymentId }))).toEqual([404, 'not_found'])
    expect(await post(`/invoices/${invoice.id}/remove-payment`, { paymentId })).toMatchObject({ status: 'open', dueAmount: 100_000, payments: [] })
    expect(codeOf(await lead.post(`/invoices/${invoice.id}/remove-payment`, { paymentId }))).toEqual([403, 'forbidden'])
  })

  it('that will not come is written off, and nothing more happens until it is reopened', async () => {
    const invoice = await open()
    await post(`/invoices/${invoice.id}/payments`, pay(10_000))
    const { version, payments: paid } = await get<InvoiceDetails>(admin, `/invoices/${invoice.id}`)
    const closed = await post(`/invoices/${invoice.id}/write-off`, { version, reason: 'Bankrupt' })
    expect(closed).toMatchObject({ status: 'closed', writeOff: { amount: 90_000, reason: 'Bankrupt' } })
    expect(codeOf(await admin.post(`/invoices/${invoice.id}/payments`, pay(1)))).toEqual([409, 'invoice_not_payable'])
    expect(codeOf(await admin.post(`/invoices/${invoice.id}/refund`, { paymentId: paid[0]?.id, amount: 1, refundedOn: today, reason: '' }))).toEqual([409, 'invoice_closed'])
    expect(codeOf(await admin.post(`/invoices/${invoice.id}/remove-payment`, { paymentId: paid[0]?.id }))).toEqual([409, 'invoice_closed'])
    expect(await post(`/invoices/${invoice.id}/reopen`, { version: closed.version })).toMatchObject({ status: 'open', dueAmount: 90_000, writeOff: null })
  })

  it('on a retainer pays invoices of its client, and comes back when a payment is taken back', async () => {
    const { id } = await post('/retainers', { clientId: client()?.id, projectId: null, name: 'Deposit' })
    const entry = (kind: string, amount: number) => admin.post(`/retainers/${id}/entries`, { kind, amount, on: today, notes: '', invoiceId: null })
    expect((await entry('top_up', 50_000)).body).toMatchObject({ balance: 50_000 })
    expect(codeOf(await entry('refund', 50_001))).toEqual([400, 'invalid_input'])
    const invoice = await open()
    expect(codeOf(await admin.post(`/invoices/${invoice.id}/pay-from-retainer`, { retainerId: id, amount: 50_001 }))).toEqual([400, 'invalid_input'])
    const answers = await Promise.all([1, 2].map(() => admin.post(`/invoices/${invoice.id}/pay-from-retainer`, { retainerId: id, amount: 30_000 })))
    expect(answers.map(({ status }) => status).sort()).toEqual([200, 400])
    const paid = await get<InvoiceDetails>(admin, `/invoices/${invoice.id}`)
    expect(paid).toMatchObject({ dueAmount: 70_000, payments: [{ method: 'retainer', amount: 30_000 }] })
    expect(codeOf(await admin.post(`/invoices/${invoice.id}/refund`, { paymentId: paid.payments[0]?.id, amount: 1, refundedOn: today, reason: '' }))).toEqual([409, 'retainer_payment'])
    await post(`/invoices/${invoice.id}/remove-payment`, { paymentId: paid.payments[0]?.id })
    expect(await get<RetainerDetails>(admin, `/retainers/${id}`)).toMatchObject({ balance: 50_000 })
    expect(codeOf(await admin.post(`/retainers/${id}/status`, { status: 'closed' }))).toEqual([409, 'has_balance'])
    const stranger2 = await open({ clientId: options.clients.find((one) => one.id !== client()?.id)?.id })
    expect(codeOf(await admin.post(`/invoices/${stranger2.id}/pay-from-retainer`, { retainerId: id, amount: 1 }))).toEqual([400, 'invalid_input'])
    expect(codeOf(await lead.get('/retainers'))).toEqual([403, 'forbidden'])
  })

  it('that is owed is on the statement', async () => {
    const statement = await get<Statement>(admin, `/clients/${client()?.id}/statement`)
    expect(statement.ageing.reduce((sum, amount) => sum + amount, 0)).toBe(statement.invoices.reduce((sum, { dueAmount }) => sum + dueAmount, 0))
    expect(codeOf(await lead.get(`/clients/${client()?.id}/statement`))).toEqual([403, 'forbidden'])
  })
})

describe('a client', () => {
  it('opens an invoice with its link only, pays it in simulation, and not twice', async () => {
    const draft = await make()
    expect(codeOf(await admin.post(`/invoices/${draft.id}/link`))).toEqual([409, 'is_draft'])
    const suggested = await get<MessageInput>(admin, `/invoices/${draft.id}/message?kind=sent`)
    expect(suggested.body).toContain(`invoice ${draft.number} for $1,000.00`)
    expect(codeOf(await admin.post(`/invoices/${draft.id}/messages`, { ...message({ recipients: [] }), version: draft.version }))).toEqual([400, 'invalid_input'])
    messages.length = 0
    const sent = await post(`/invoices/${draft.id}/messages`, { ...message(), version: draft.version })
    expect(sent).toMatchObject({ status: 'open', messages: [{ kind: 'sent', recipients: [{ email: 'pat@client.example' }] }] })
    expect(messages[0]).toMatchObject({ kind: 'invoice_sent', to: { email: 'pat@client.example' } })
    // Stored messages never hold the link.
    expect(JSON.stringify(sent)).not.toContain(sentToken() ?? 'none')

    const token = sentToken()
    const seen = (await stranger.post('/client/invoice', { token })).body as ClientInvoice
    expect(seen).toMatchObject({ number: draft.number, total: 100_000, status: 'open', online: 'simulated' })
    expect(codeOf(await stranger.post('/client/invoice', { token: 'x'.repeat(43) }))).toEqual([410, 'link_invalid'])
    expect(codeOf(await stranger.post('/client/invoice', { token: { nested: true } }))).toEqual([410, 'link_invalid'])
    const answers = await Promise.all([1, 2].map(() => stranger.post('/client/invoice/pay', { token })))
    expect(answers.map(({ status }) => status).sort()).toEqual([200, 409])
    expect(await get<InvoiceDetails>(admin, `/invoices/${draft.id}`)).toMatchObject({ status: 'paid', payments: [{ simulated: true, method: 'online' }] })

    await post(`/invoices/${draft.id}/revoke-links`)
    expect(codeOf(await stranger.post('/client/invoice', { token }))).toEqual([410, 'link_invalid'])
  })

  it('cannot open a draft, nor pay in production where nothing is set up', async () => {
    const invoice = await open()
    const { link } = (await admin.post(`/invoices/${invoice.id}/link`)).body as { link: string }
    const token = link.split('#')[1]
    const production = browser(testApp({ db: database.db, now: clock.now, email: sender }))
    expect((await production.post('/client/invoice', { token })).body).toMatchObject({ online: null })
    expect(codeOf(await production.post('/client/invoice/pay', { token }))).toEqual([409, 'invoice_not_payable'])
    await post(`/invoices/${invoice.id}/draft`, { version: invoice.version })
    expect(codeOf(await stranger.post('/client/invoice', { token }))).toEqual([410, 'link_invalid'])
  })

  it('gets the files that are attached, and no others', async () => {
    const invoice = await open()
    const upload = await request(app).put(`/api/invoices/${invoice.id}/attachments?name=plan.pdf`).set('Cookie', admin.cookie ?? '').set('X-CSRF-Token', admin.csrfToken ?? '').set('Content-Type', 'application/octet-stream').send(Buffer.from('%PDF-1.4 x'))
    const [file] = (upload.body as InvoiceDetails).attachments
    expect(file?.name).toBe('plan.pdf')
    const { link } = (await admin.post(`/invoices/${invoice.id}/link`)).body as { link: string }
    const token = link.split('#')[1]
    expect((await stranger.post('/client/invoice/file', { token, fileId: file?.id })).body).toMatchObject({ name: 'plan.pdf', mediaType: 'application/pdf' })
    expect(codeOf(await stranger.post('/client/invoice/file', { token, fileId: 1 }))).toEqual([404, 'not_found'])
    expect(codeOf(await lead.get(`/invoices/${invoice.id}/attachments/${file?.id}`))).toEqual([403, 'forbidden'])
    expect((await post(`/invoices/${invoice.id}/detach`, { fileId: file?.id })).attachments).toEqual([])
  })
})

describe('Stripe', () => {
  const secret = 'whsec_test'
  const provider = stripePayments({ secretKey: 'sk_test', webhookSecret: secret })
  const notice = (body: object, at = clock.now()) => {
    const text = JSON.stringify(body)
    const time = Math.floor(at.getTime() / 1000)
    return { text, signature: `t=${time},v1=${createHmac('sha256', secret).update(`${time}.${text}`).digest('hex')}` }
  }
  const completed = (invoice: number, id: string, amount: number) => ({
    type: 'checkout.session.completed', data: { object: { id, payment_status: 'paid', amount_total: amount, currency: 'usd', metadata: { invoice: String(invoice) } } },
  })

  it('counts a signed notice once, and refuses any other', async () => {
    const stripeApp = testApp({ db: database.db, now: clock.now, email: sender, payments: provider })
    const send = ({ text, signature }: { text: string; signature: string }) => request(stripeApp).post('/api/payment-notice').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(text)
    const invoice = await open()
    const good = notice(completed(invoice.id, 'cs_1', 40_000))
    expect((await send({ ...good, signature: good.signature.replace(/v1=.*/, `v1=${'0'.repeat(64)}`) })).status).toBe(400)
    expect((await send(notice(completed(invoice.id, 'cs_old', 1), new Date(clock.now().getTime() - 3_600_000)))).status).toBe(400)
    expect((await send(good)).status).toBe(200)
    expect((await send(good)).status).toBe(200)
    expect(await get<InvoiceDetails>(admin, `/invoices/${invoice.id}`)).toMatchObject({ dueAmount: 60_000, payments: [{ method: 'online', simulated: false }] })
    // More than is due: what is due is counted, and someone is told.
    expect((await send(notice(completed(invoice.id, 'cs_2', 90_000)))).status).toBe(200)
    expect(await get<InvoiceDetails>(admin, `/invoices/${invoice.id}`)).toMatchObject({ status: 'paid', dueAmount: 0 })
    expect(await database.db.$count(payments, and(eq(payments.invoiceId, invoice.id)))).toBe(2)
    expect((await request(app).post('/api/payment-notice').set('Stripe-Signature', good.signature).send(good.text)).status).toBeGreaterThanOrEqual(400)
  })
})

describe('an estimate', () => {
  const estimate = async (more: object = {}) => {
    const { issuedOn, ...rest } = input()
    const made = await admin.post('/estimates', { ...rest, issuedOn, expiresOn: '2026-12-31', ...more })
    expect(made.status).toBe(201)
    return get<EstimateDetails>(admin, `/estimates/${(made.body as { id: number }).id}`)
  }

  it('is accepted through its link, once, and becomes an invoice and a project, once', async () => {
    const made = await estimate()
    messages.length = 0
    const sent = (await admin.post(`/estimates/${made.id}/messages`, { ...message(), version: made.version })).body as EstimateDetails
    expect(sent.status).toBe('sent')
    const token = sentToken()
    expect((await stranger.post('/client/estimate', { token })).body).toMatchObject({ status: 'sent', total: 100_000 } satisfies Partial<ClientEstimate>)
    // A link to an estimate opens no invoice.
    expect(codeOf(await stranger.post('/client/invoice', { token }))).toEqual([410, 'link_invalid'])
    const answer = { token, answer: 'accepted', name: 'Pat Example', comment: 'Please start' }
    expect((await stranger.post('/client/estimate/answer', answer)).body).toMatchObject({ status: 'accepted', answer: { name: 'Pat Example' } })
    expect(codeOf(await stranger.post('/client/estimate/answer', { ...answer, answer: 'declined' }))).toEqual([409, 'answered'])
    const accepted = await get<EstimateDetails>(admin, `/estimates/${made.id}`)
    expect(accepted.answers).toMatchObject([{ answer: 'accepted', byClient: true }])
    const invoice = await admin.post(`/estimates/${made.id}/invoice`, { version: accepted.version })
    expect(await get(admin, `/invoices/${(invoice.body as { id: number }).id}`)).toMatchObject({ status: 'draft', total: 100_000 })
    const after = await get<EstimateDetails>(admin, `/estimates/${made.id}`)
    expect(codeOf(await admin.post(`/estimates/${made.id}/invoice`, { version: after.version }))).toEqual([409, 'has_invoice'])
    expect((await admin.post(`/estimates/${made.id}/project`, { version: after.version, name: 'From an estimate' })).status).toBe(201)
    expect(await get(admin, `/estimates/${made.id}`)).toMatchObject({ project: { name: 'From an estimate' }, canCreateProject: false })
  })

  it('that expired is not accepted, one that is changed is asked again, and a deleted one keeps its number', async () => {
    const made = await estimate({ issuedOn: '2026-10-01', expiresOn: '2026-11-01' })
    const sent = (await admin.post(`/estimates/${made.id}/send`, { version: made.version })).body as EstimateDetails
    expect(sent).toMatchObject({ status: 'sent', expired: true })
    const { link } = (await admin.post(`/estimates/${made.id}/link`)).body as { link: string }
    expect(codeOf(await stranger.post('/client/estimate/answer', { token: link.split('#')[1], answer: 'accepted', name: 'Pat Example', comment: '' }))).toEqual([409, 'expired'])
    const declined = (await admin.post(`/estimates/${made.id}/answer`, { version: sent.version, answer: 'declined', name: '', comment: 'On the phone' })).body as EstimateDetails
    expect(declined.status).toBe('declined')
    const { issuedOn: _issuedOn, ...rest } = input({ version: declined.version })
    const changed = (await admin.put(`/estimates/${made.id}`, { ...rest, issuedOn: today, expiresOn: null })).body as EstimateDetails
    expect(changed.status).toBe('sent')
    expect(codeOf(await admin.post('/estimates', { ...rest, issuedOn: today, expiresOn: null, number: changed.number }))).toEqual([400, 'invalid_input'])
    expect((await admin.post(`/estimates/${made.id}/delete`, { version: changed.version })).status).toBe(200)
    expect(codeOf(await admin.post('/estimates', { ...rest, issuedOn: today, expiresOn: null, number: changed.number }))).toEqual([400, 'invalid_input'])
    expect(codeOf(await lead.get('/estimates'))).toEqual([403, 'forbidden'])
  })
})

describe('a recurring invoice', () => {
  const create = async (more: object = {}) => {
    const { number: _number, issuedOn: _issuedOn, dueOn: _dueOn, ...rest } = input()
    const body = { ...rest, clientId: client()?.id, paymentTermDays: null, frequency: 'monthly', interval: 1, startsOn: '2026-09-30', endsOn: null, sendAutomatically: false, ...more }
    const made = await admin.post('/recurring', body)
    expect(made.status).toBe(201)
    return { id: (made.body as { id: number }).id, body }
  }
  const context = () => createContext({ db: database.db, basePath: '/', now: clock.now, email: sender })
  const made = (id: number) => database.db.select().from(invoices).where(eq(invoices.recurringInvoiceId, id)).orderBy(invoices.recurringOn)

  it('is made for every date that is due, each once, also when asked twice at the same time', async () => {
    const { id } = await create()
    await Promise.all([makeDueInvoices(context()), makeDueInvoices(context())])
    await makeDueInvoices(context())
    expect((await made(id)).map(({ recurringOn, status, total }) => [recurringOn, status, total])).toEqual([['2026-09-30', 'draft', 100_000], ['2026-10-30', 'draft', 100_000]])
    expect(await get<RecurringDetails>(admin, `/recurring/${id}`)).toMatchObject({ nextOn: '2026-11-30', made: 2, status: 'active' })
    expect(codeOf(await admin.delete(`/recurring/${id}`))).toEqual([409, 'in_use'])
    expect((await admin.post(`/recurring/${id}/status`, { status: 'paused' })).body).toMatchObject({ status: 'paused' })
    expect((await admin.post(`/recurring/${id}/status`, { status: 'active' })).body).toMatchObject({ status: 'active', nextOn: '2026-11-30' })
  })

  it('is sent by itself, ends, and pauses for an archived client', async () => {
    const { id } = await create({ startsOn: '2026-11-20', endsOn: '2026-11-30', sendAutomatically: true })
    messages.length = 0
    await makeDueInvoices(context())
    expect((await made(id)).map(({ status }) => status)).toEqual(['open'])
    expect(messages.some(({ kind }) => kind === 'invoice_sent')).toBe(true)
    expect(await get(admin, `/recurring/${id}`)).toMatchObject({ status: 'ended', nextOn: null })

    const { id: other } = await create({ startsOn: '2026-11-21' })
    const [row] = await database.db.select().from(recurringInvoices).where(eq(recurringInvoices.id, other))
    await database.db.update(clients).set({ archivedAt: clock.now() }).where(eq(clients.id, row?.clientId ?? 0))
    await makeDueInvoices(context())
    expect(await made(other)).toEqual([])
    expect(codeOf(await admin.post(`/recurring/${other}/status`, { status: 'active' }))).toEqual([409, 'client_archived'])
    await database.db.update(clients).set({ archivedAt: null }).where(eq(clients.id, row?.clientId ?? 0))
  })
})
