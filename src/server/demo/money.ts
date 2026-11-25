/** Invoices, payments, retainers and estimates of the demo, made by the real billing code. */
import { eq, type InferInsertModel, sql } from 'drizzle-orm'
import { documentTotals } from '../../shared/calc'
import { addDays, addMonths, type IsoDate } from '../../shared/dates'
import type { PaymentMethod } from '../../shared/domain'
import {
  allocateNumber, changeInvoiceLines, type Claim, createInvoiceFromEntries, type Invoice, type NewInvoice,
  recordPaymentIn,
} from '../billing'
import type { Tx } from '../db'
import {
  clients, estimateAnswerRecords, estimateLines, estimateMessages, estimates, invoiceLines, invoiceMessages, invoices,
  invoiceWriteOffs, itemCategories, outboxMessages, recurringInvoiceLines, recurringInvoices, retainerEntries,
  retainers,
} from '../db/schema'
import type { DemoDates } from './builder'
import type { ClientKey, Company, ProjectKey } from './company'
import type { Work } from './work'

/** Projects whose time is invoiced by the hour. */
const hourly: Partial<Record<ClientKey, ProjectKey[]>> = {
  tallgrass: ['turbine', 'substation'],
  fernhollow: ['pumps'],
  kestrel: ['assembly', 'safety'],
  lumen: ['coldStore'],
  quarry: ['quarry'],
}

interface Line {
  description: string
  /** Thousandths. */
  quantity: number
  unitPrice: number
  kind?: 'manual' | 'retainer'
  category?: 'Service' | 'Product'
  project?: ProjectKey
}

interface Received {
  /** Days from today. */
  on: number
  /** The share of what is due, in percent; 100 settles the invoice. */
  percent?: number
  amount?: number
  method: PaymentMethod
}

interface Plan {
  client: ClientKey
  /** Days from today. */
  issued: number
  terms: 'net_15' | 'net_30' | 'net_60' | 'custom'
  subject: string
  /** Weeks of time and expenses to bill, counted from this week, or free-form lines. */
  work: [number, number] | Line[]
  grouping?: Claim['timeGrouping']
  /** Left out for a draft. */
  sent?: {
    received?: Received[]
    writeOff?: { on: number; reason: string }
  }
  recurring?: { id: number; on: IsoDate }
  after?: (invoice: Invoice, paymentIds: number[]) => Promise<void>
}

const termDays = { net_15: 15, net_30: 30, net_60: 60, custom: 21 }

const dollars = (amount: number) => Math.round(amount * 100)
const one = 1000

export async function addMoney(tx: Tx, dates: DemoDates, company: Company, work: Work): Promise<void> {
  const { daysFromToday, past } = dates
  const admin = company.people.admin.id
  const categories = await tx.select().from(itemCategories)
  const categoryId = (name: string) => categories.find((category) => category.name === name)?.id ?? null
  const clientRows = await tx.select().from(clients)
  const clientOf = (key: ClientKey) => only(clientRows.filter(({ id }) => id === company.clients[key]))
  let simulated = 0

  const header = (client: ClientKey) => {
    const { id, currency, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent } = clientOf(client)
    return { clientId: id, currency, discountPercent, tax1Name, tax1Percent, tax2Name, tax2Percent, createdBy: admin }
  }
  const lineValues = (lines: readonly Line[], client: ClientKey) =>
    lines.map(({ description, quantity, unitPrice, category = 'Service', project }, index) => ({
      position: index + 1, description, quantity, unitPrice, amount: 0, categoryId: categoryId(category),
      projectId: project ? company.projects[project] : null,
      tax1: clientOf(client).tax1Percent !== null, tax2: clientOf(client).tax2Percent !== null,
    }))

  const claimFor = ({ client, work: weeks, grouping }: Plan): Claim => {
    if (typeof weeks[0] !== 'number') throw new Error('Not a plan for time')
    const [first, last] = [dates.week(weeks[0]), dates.week(weeks[1] as number, 6)]
    const projects = hourly[client] ?? []
    const chosen = (entries: Work['time']) =>
      entries
        .filter(({ project, date, billable }) => projects.includes(project) && billable && date >= first && date <= last)
        .map(({ id }) => ({ id, version: 1 }))
    const taxes = { tax1: clientOf(client).tax1Percent !== null, tax2: clientOf(client).tax2Percent !== null }
    return {
      timeEntries: chosen(work.time), expenses: chosen(work.expenses), timeGrouping: grouping ?? 'task',
      timeLines: { categoryId: categoryId('Service'), ...taxes }, expenseLines: { categoryId: categoryId('Product') },
    }
  }

  const make = async (plan: Plan) => {
    const issuedOn = daysFromToday(plan.issued)
    const values: NewInvoice = {
      ...header(plan.client), subject: plan.subject, issuedOn, dueOn: addDays(issuedOn, termDays[plan.terms]),
      paymentTerms: plan.terms, purchaseOrder: plan.client === 'tallgrass' ? 'PO-55-0187' : '',
      notes: 'Thank you for your business.',
    }
    let invoice: Invoice
    if (typeof plan.work[0] === 'number') {
      invoice = await createInvoiceFromEntries(tx, values, claimFor(plan))
    } else {
      const lines = plan.work as Line[]
      const number = await allocateNumber(tx, 'invoice')
      const recurring = plan.recurring && { recurringInvoiceId: plan.recurring.id, recurringOn: plan.recurring.on }
      const created = only(await tx.insert(invoices).values({ ...values, ...recurring, number }).returning())
      invoice = await changeInvoiceLines(tx, created.id, async () => {
        await tx.insert(invoiceLines).values(
          lineValues(lines, plan.client).map((line, index) => ({
            ...line, invoiceId: created.id, kind: lines[index]?.kind ?? 'manual',
          })),
        )
      })
    }
    if (!plan.sent) return
    await send(invoice, plan.client)

    const paymentIds: number[] = []
    for (const { on, percent = 100, amount, method } of plan.sent.received ?? []) {
      const { dueAmount } = only(await tx.select().from(invoices).where(eq(invoices.id, invoice.id)))
      const online = method === 'online'
      const { payment } = await recordPaymentIn(tx, {
        invoiceId: invoice.id, amount: amount ?? Math.floor((dueAmount * percent) / 100), paidOn: daysFromToday(on), method,
        reference: method === 'check' ? `Check ${1200 + invoice.id}` : '',
        // Never a real charge.
        ...(online && {
          provider: 'simulated', providerReference: `simulated-${++simulated}`,
          notes: 'Simulated online payment. No money was moved.',
        }),
        recordedBy: online ? null : admin,
      })
      paymentIds.push(payment.id)
    }
    if (plan.sent.writeOff) {
      const { on, reason } = plan.sent.writeOff
      const closedOn = daysFromToday(on)
      const { dueAmount } = only(
        await tx.update(invoices).set({ status: 'closed', closedOn }).where(eq(invoices.id, invoice.id)).returning(),
      )
      await tx.insert(invoiceWriteOffs).values({
        invoiceId: invoice.id, amount: dueAmount, writtenOffOn: closedOn, reason, recordedBy: admin,
      })
    }
    await plan.after?.(invoice, paymentIds)
  }

  const send = async (invoice: Invoice, client: ClientKey) => {
    const sentAt = past(invoice.issuedOn, 10)
    await tx.update(invoices).set({ status: 'open', sentAt }).where(eq(invoices.id, invoice.id))
    const recipients = [billingContact[client]]
    const subject = `Invoice ${invoice.number} from JET Engineering`
    const body = `Please find invoice ${invoice.number}, due on ${invoice.dueOn}.`
    await tx.insert(invoiceMessages).values({
      invoiceId: invoice.id, kind: 'sent', senderId: admin, recipients, subject, body, createdAt: sentAt,
    })
    await tx.insert(outboxMessages).values({
      kind: 'invoice', status: 'captured', recipients, subject, body, subjectType: 'invoice', subjectId: invoice.id,
      createdBy: admin, createdAt: sentAt, updatedAt: sentAt,
    })
  }

  // Retainer ---------------------------------------------------------------------------------------
  const retainer = only(
    await tx
      .insert(retainers)
      .values({ clientId: company.clients.tallgrass, projectId: company.projects.turbine, name: 'Turbine retainer', currency: 'USD' })
      .returning(),
  )
  const ledger = (kind: 'top_up' | 'draw_down', amount: number, on: number, notes: string) =>
    async (invoice: Invoice, paymentIds: number[]) => {
      await tx.insert(retainerEntries).values({
        retainerId: retainer.id, kind, amount, occurredOn: daysFromToday(on), invoiceId: invoice.id,
        paymentId: paymentIds[0] ?? null, notes, recordedBy: admin,
      })
    }

  // Recurring --------------------------------------------------------------------------------------
  const supportStart = daysFromToday(-70)
  const support: Line[] = [{ description: 'Remote support, one month', quantity: one, unitPrice: dollars(650) }]
  const recurring = only(
    await tx
      .insert(recurringInvoices)
      .values({
        ...header('fernhollow'), subject: 'Monthly remote support', frequency: 'monthly', startsOn: supportStart,
        nextOn: addMonths(supportStart, 3), status: 'active',
      })
      .returning(),
  )
  await tx.insert(recurringInvoiceLines).values(
    lineValues(support, 'fernhollow').map((line) => ({ ...line, amount: line.unitPrice, recurringInvoiceId: recurring.id })),
  )
  const supportInvoice = (month: number, received: Received[]): Plan => {
    const on = addMonths(supportStart, month)
    const issued = Math.round((Date.parse(on) - Date.parse(dates.today)) / 86_400_000)
    return {
      client: 'fernhollow', issued, terms: 'net_30', subject: 'Monthly remote support', work: support, sent: { received },
      recurring: { id: recurring.id, on },
    }
  }

  const paid = (on: number, method: PaymentMethod): Plan['sent'] => ({ received: [{ on, method }] })
  const plans: Plan[] = [
    // Four weeks at a time; the last six weeks are still to be billed.
    { client: 'tallgrass', issued: -150, terms: 'net_30', subject: 'Engineering services', work: [-26, -23], sent: paid(-122, 'check') },
    { client: 'fernhollow', issued: -149, terms: 'net_30', subject: 'Pump station upgrade', work: [-26, -23], sent: paid(-118, 'bank_transfer') },
    { client: 'kestrel', issued: -148, terms: 'net_30', subject: 'Assembly line and safety', work: [-26, -23], sent: paid(-110, 'bank_transfer') },
    { client: 'lumen', issued: -130, terms: 'custom', subject: 'Cold store expansion', work: [-26, -23], sent: {} },
    { client: 'tallgrass', issued: -120, terms: 'net_30', subject: 'Engineering services', work: [-22, -19], grouping: 'person', sent: paid(-95, 'online') },
    { client: 'fernhollow', issued: -119, terms: 'net_30', subject: 'Pump station upgrade', work: [-22, -19], sent: paid(-88, 'bank_transfer') },
    {
      client: 'kestrel', issued: -118, terms: 'net_30', subject: 'Assembly line and safety', work: [-22, -19], grouping: 'project',
      sent: {
        received: [{ on: -70, percent: 80, method: 'bank_transfer' }],
        writeOff: { on: -20, reason: 'Disputed hours, agreed with the client' },
      },
    },
    { client: 'lumen', issued: -117, terms: 'custom', subject: 'Cold store expansion', work: [-22, -19], sent: paid(-99, 'card') },
    {
      client: 'tallgrass', issued: -100, terms: 'net_15', subject: 'Turbine retainer',
      work: [{ description: 'Retainer for engineering services', quantity: one, unitPrice: dollars(10_000), kind: 'retainer', project: 'turbine' }],
      sent: paid(-86, 'check'), after: ledger('top_up', dollars(10_000), -86, 'Retainer paid'),
    },
    { client: 'tallgrass', issued: -92, terms: 'net_30', subject: 'Engineering services', work: [-18, -15], sent: paid(-65, 'check') },
    { client: 'fernhollow', issued: -90, terms: 'net_15', subject: 'Pump station upgrade', work: [-18, -15], sent: {} },
    { client: 'kestrel', issued: -89, terms: 'net_30', subject: 'Assembly line and safety', work: [-18, -15], sent: paid(-61, 'bank_transfer') },
    { client: 'lumen', issued: -88, terms: 'custom', subject: 'Cold store expansion', work: [-18, -15], grouping: 'person', sent: paid(-68, 'online') },
    { client: 'quarry', issued: -80, terms: 'net_30', subject: 'Conveyor route survey', work: [-26, -13], grouping: 'task', sent: paid(-56, 'check') },
    supportInvoice(0, [{ on: -50, method: 'bank_transfer' }]),
    {
      client: 'fernhollow', issued: -66, terms: 'net_30', subject: 'Control system integration, milestone 1',
      work: [
        { description: 'Milestone 1: design approved', quantity: one, unitPrice: dollars(34_400), project: 'controls' },
        { description: 'Operator panel', quantity: 2 * one, unitPrice: dollars(1845.5), category: 'Product', project: 'controls' },
        { description: 'Agreed reduction', quantity: -one, unitPrice: dollars(500), project: 'controls' },
      ],
      sent: paid(-40, 'bank_transfer'),
    },
    { client: 'kestrel', issued: -62, terms: 'net_60', subject: 'Assembly line and safety', work: [-14, -11], sent: {} },
    {
      client: 'tallgrass', issued: -60, terms: 'net_15', subject: 'Engineering services', work: [-14, -11],
      sent: { received: [{ on: -50, amount: dollars(4000), method: 'retainer' }] },
      after: ledger('draw_down', -dollars(4000), -50, 'Used for engineering services'),
    },
    { client: 'fernhollow', issued: -58, terms: 'net_30', subject: 'Pump station upgrade', work: [-14, -11], sent: paid(-30, 'bank_transfer') },
    { client: 'lumen', issued: -57, terms: 'custom', subject: 'Cold store expansion', work: [-14, -11], sent: paid(-33, 'card') },
    {
      client: 'kestrel', issued: -42, terms: 'net_30', subject: 'Assembly line and safety', work: [-10, -7],
      sent: { received: [{ on: -15, percent: 50, method: 'bank_transfer' }] },
    },
    supportInvoice(1, [{ on: -14, method: 'bank_transfer' }]),
    { client: 'tallgrass', issued: -20, terms: 'net_30', subject: 'Engineering services', work: [-10, -7], sent: {} },
    { client: 'fernhollow', issued: -15, terms: 'net_30', subject: 'Pump station upgrade', work: [-10, -7], grouping: 'detailed', sent: {} },
    supportInvoice(2, []),
    {
      client: 'lumen', issued: -1, terms: 'custom', subject: 'Loading dock study',
      work: [{ description: 'Loading dock study, as estimated', quantity: one, unitPrice: dollars(6800) }], sent: {},
      after: (invoice) => linkEstimate(invoice.id),
    },
    { client: 'lumen', issued: -1, terms: 'custom', subject: 'Cold store expansion', work: [-10, -7] },
  ]

  // Estimates --------------------------------------------------------------------------------------
  const estimate = async (
    client: ClientKey,
    subject: string,
    status: InferInsertModel<typeof estimates>['status'],
    issued: number,
    lines: Line[],
    answer?: { on: number; name: string; comment: string },
    projectId: number | null = null,
  ) => {
    const issuedOn = daysFromToday(issued)
    const values = lineValues(lines, client)
    const { lineAmounts, subtotal, discount, tax1, tax2, total } = documentTotals(values, header(client))
    const createdAt = past(issuedOn, 9)
    const { id, number } = only(
      await tx
        .insert(estimates)
        .values({
          ...header(client), number: await allocateNumber(tx, 'estimate'), subject, status, issuedOn,
          expiresOn: addDays(issuedOn, 30), subtotal, discountAmount: discount, tax1Amount: tax1, tax2Amount: tax2, total,
          sentAt: status === 'draft' ? null : past(issuedOn, 10), projectId, createdAt, updatedAt: createdAt,
        })
        .returning(),
    )
    await tx.insert(estimateLines).values(
      values.map((line, index) => ({ ...line, amount: lineAmounts[index] ?? 0, estimateId: id })),
    )
    if (status === 'draft') return
    const recipients = [billingContact[client]]
    const message = { subject: `Estimate ${number} from JET Engineering`, body: `Please find estimate ${number}.` }
    const sentAt = past(issuedOn, 10)
    await tx.insert(estimateMessages).values({
      estimateId: id, kind: 'sent', senderId: admin, recipients, ...message, createdAt: sentAt,
    })
    await tx.insert(outboxMessages).values({
      kind: 'estimate', status: 'captured', recipients, ...message, subjectType: 'estimate', subjectId: id, createdBy: admin,
      createdAt: sentAt, updatedAt: sentAt,
    })
    if (answer && status !== 'sent') {
      await tx.insert(estimateAnswerRecords).values({
        estimateId: id, answer: status === 'accepted' ? 'accepted' : 'declined', name: answer.name, comment: answer.comment,
        recordedBy: admin, answeredAt: past(daysFromToday(answer.on), 14),
      })
    }
  }
  const linkEstimate = async (invoiceId: number) => {
    await tx.update(estimates).set({ invoiceId }).where(eq(estimates.subject, 'Loading dock study'))
  }
  await estimate(
    'quarry', 'Second conveyor survey', 'declined', -75,
    [{ description: 'Survey and drawings', quantity: 90 * one, unitPrice: dollars(105) }],
    { on: -62, name: 'Hollis Drummond', comment: 'Postponed for budget reasons.' },
  )
  await estimate(
    'lumen', 'Boiler replacement', 'accepted', -48,
    [
      { description: 'Design and permits', quantity: one, unitPrice: dollars(14_500), project: 'boiler' },
      { description: 'Installation supervision', quantity: 160 * one, unitPrice: dollars(128) },
      { description: 'Start-up and training', quantity: one, unitPrice: dollars(7520) },
    ],
    { on: -33, name: 'Bea Castellan', comment: 'Please start after the holidays.' }, company.projects.boiler,
  )
  await estimate(
    'lumen', 'Loading dock study', 'accepted', -35,
    [{ description: 'Loading dock study', quantity: one, unitPrice: dollars(6800) }],
    { on: -25, name: 'Bea Castellan', comment: '' },
  )
  await estimate(
    'tallgrass', 'Access road drainage', 'accepted', -18,
    [{ description: 'Drainage design', quantity: 64 * one, unitPrice: dollars(140) }],
    { on: -9, name: 'Renata Holm', comment: 'Go ahead.' },
  )
  await estimate('fernhollow', 'Reservoir level sensors', 'sent', -6, [
    { description: 'Sensor installation', quantity: 12.5 * one, unitPrice: dollars(128) },
    { description: 'Level sensor', quantity: 6 * one, unitPrice: dollars(412.75), category: 'Product' },
  ])
  await estimate('kestrel', 'Guarding for cell 4', 'draft', -2, [
    { description: 'Risk assessment', quantity: 24 * one, unitPrice: dollars(110) },
    { description: 'Guarding design', quantity: 40 * one, unitPrice: dollars(118) },
  ])

  // In order of issue, so that numbers go up with time. The sort is stable, so the draft stays last.
  for (const plan of [...plans].sort((a, b) => a.issued - b.issued)) await make(plan)

  await setTimes(tx, dates)
}

const billingContact: Record<ClientKey, { name: string; email: string }> = {
  tallgrass: { name: 'Gil Abara', email: 'payables@tallgrass.example' },
  fernhollow: { name: 'Samir Dewitt', email: 'samir.dewitt@fernhollow.example' },
  kestrel: { name: 'Anke Vollmer', email: 'anke.vollmer@kestrel.example' },
  lumen: { name: 'Bea Castellan', email: 'bea.castellan@lumenridge.example' },
  internal: { name: 'Avery Test', email: 'office@jet.example' },
  quarry: { name: 'Hollis Drummond', email: 'hollis@oldquarry.example' },
}

/** Billing code stamps records with the current time; here they are as old as they claim to be. */
async function setTimes(tx: Tx, { timeZone, now }: DemoDates) {
  const at = (date: string, hour: number) =>
    sql`least((${sql.identifier(date)} + make_interval(hours => ${hour}::int)) at time zone ${timeZone}::text, ${now.toISOString()}::timestamptz)`
  await tx.execute(sql`update invoices set created_at = ${at('issued_on', 9)}, updated_at = ${at('issued_on', 10)}`)
  await tx.execute(sql`update payments set created_at = ${at('paid_on', 11)}`)
  await tx.execute(sql`update invoice_write_offs set created_at = ${at('written_off_on', 11)}`)
  await tx.execute(sql`update retainer_entries set created_at = ${at('occurred_on', 11)}`)
}

function only<T>(rows: T[]): T {
  const [row] = rows
  if (row === undefined) throw new Error('Expected a record')
  return row
}
