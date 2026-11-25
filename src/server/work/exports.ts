/** Everything as tables, to take along. Receipts and passwords are not in it. */
import { asc, eq } from 'drizzle-orm'
import { currencyExponent } from '../../shared/currency'
import type { Actor } from '../access/actor'
import { requireAdministrator } from '../access/decisions'
import type { AppContext } from '../context'
import { runTransaction, type Tx } from '../db'
import {
  clients, contacts, expenseCategories, expenses, invoiceLines, invoices, payments, people, personRates, projects, tasks, timeEntries,
} from '../db/schema'
import { getSettings } from '../people/lookup'
import { logChange } from './common'

export type Cell = string | number
type Table = Cell[][]

/** Minor units as a number with decimals, and minutes as hours. */
const money = (amount: number | null, currency: string): Cell => {
  const exponent = currencyExponent(currency)
  return amount === null ? '' : (amount / 10 ** exponent).toFixed(exponent)
}
const hours = (minutes: number): Cell => (minutes / 60).toFixed(2)
const yes = (value: boolean): Cell => (value ? 'yes' : 'no')

const tables: Record<string, (tx: Tx, companyCurrency: string) => Promise<Table>> = {
  people: async (tx) => [
    ['Name', 'Email', 'Kind', 'Status', 'Hours a week', 'Started', 'Phone'],
    ...(await tx.select().from(people).orderBy(asc(people.id))).map((row) => [row.name, row.email, row.kind, row.status, hours(row.weeklyCapacityMinutes), row.startedOn ?? '', row.phone ?? '']),
  ],
  rates: async (tx, company) => [
    ['Person', 'Kind', 'From', 'Rate an hour'],
    ...(await tx.select({ rate: personRates, name: people.name }).from(personRates).innerJoin(people, eq(people.id, personRates.personId)).orderBy(asc(people.name), asc(personRates.startsOn))).map(
      ({ rate, name }) => [name, rate.kind, rate.startsOn, money(rate.rate, company)],
    ),
  ],
  clients: async (tx) => [
    ['Client', 'Currency', 'Address', 'Payment terms', 'Archived'],
    ...(await tx.select().from(clients).orderBy(asc(clients.name))).map((row) => [row.name, row.currency, row.address, row.paymentTerms, yes(row.archivedAt !== null)]),
  ],
  contacts: async (tx) => [
    ['Client', 'Name', 'Title', 'Email', 'Office phone', 'Mobile phone'],
    ...(await tx.select({ contact: contacts, client: clients.name }).from(contacts).innerJoin(clients, eq(clients.id, contacts.clientId)).orderBy(asc(clients.name), asc(contacts.name))).map(
      ({ contact, client }) => [client, contact.name, contact.title, contact.email ?? '', contact.officePhone ?? '', contact.mobilePhone ?? ''],
    ),
  ],
  projects: async (tx) => [
    ['Client', 'Project', 'Code', 'Type', 'Starts', 'Ends', 'Hourly rate', 'Fixed fee', 'Budget hours', 'Budget amount', 'Archived'],
    ...(await tx.select({ project: projects, client: clients.name, currency: clients.currency }).from(projects).innerJoin(clients, eq(clients.id, projects.clientId)).orderBy(asc(clients.name), asc(projects.name))).map(
      ({ project, client, currency }) => [
        client, project.name, project.code, project.type, project.startsOn ?? '', project.endsOn ?? '', money(project.rate, currency), money(project.fixedFee, currency),
        project.budgetMinutes === null ? '' : hours(project.budgetMinutes), money(project.budgetAmount, currency), yes(project.archivedAt !== null),
      ],
    ),
  ],
  tasks: async (tx, company) => [
    ['Task', 'Billable', 'Rate', 'Common', 'Archived'],
    ...(await tx.select().from(tasks).orderBy(asc(tasks.name))).map((row) => [row.name, yes(row.billableByDefault), money(row.defaultRate, company), yes(row.common), yes(row.archivedAt !== null)]),
  ],
  time: async (tx) => [
    ['Date', 'Person', 'Client', 'Project', 'Task', 'Hours', 'Billable', 'Status', 'Notes'],
    ...(
      await tx
        .select({ entry: timeEntries, person: people.name, client: clients.name, project: projects.name, task: tasks.name })
        .from(timeEntries)
        .innerJoin(people, eq(people.id, timeEntries.personId))
        .innerJoin(projects, eq(projects.id, timeEntries.projectId))
        .innerJoin(clients, eq(clients.id, projects.clientId))
        .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
        .orderBy(asc(timeEntries.spentOn), asc(timeEntries.id))
    ).map(({ entry, person, client, project, task }) => [entry.spentOn, person, client, project, task, hours(entry.minutes), yes(entry.billable), entry.status, entry.notes]),
  ],
  expenses: async (tx) => [
    ['Date', 'Person', 'Client', 'Project', 'Category', 'Amount', 'Currency', 'Billable', 'Status', 'Paying back', 'Notes'],
    ...(
      await tx
        .select({ expense: expenses, person: people.name, client: clients.name, project: projects.name, category: expenseCategories.name })
        .from(expenses)
        .innerJoin(people, eq(people.id, expenses.personId))
        .innerJoin(projects, eq(projects.id, expenses.projectId))
        .innerJoin(clients, eq(clients.id, projects.clientId))
        .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        .orderBy(asc(expenses.spentOn), asc(expenses.id))
    ).map(({ expense, person, client, project, category }) => [
      expense.spentOn, person, client, project, category, money(expense.amount, expense.currency), expense.currency, yes(expense.billable), expense.status, expense.reimbursementStatus, expense.notes,
    ]),
  ],
  invoices: async (tx) => [
    ['Number', 'Client', 'Subject', 'Status', 'Issued', 'Due', 'Currency', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Still due'],
    ...(await tx.select({ invoice: invoices, client: clients.name }).from(invoices).innerJoin(clients, eq(clients.id, invoices.clientId)).orderBy(asc(invoices.issuedOn), asc(invoices.id))).map(
      ({ invoice, client }) => [
        invoice.number, client, invoice.subject, invoice.status, invoice.issuedOn, invoice.dueOn, invoice.currency, money(invoice.subtotal, invoice.currency), money(invoice.discountAmount, invoice.currency),
        money(invoice.tax1Amount + invoice.tax2Amount, invoice.currency), money(invoice.total, invoice.currency), money(invoice.paidAmount, invoice.currency), money(invoice.dueAmount, invoice.currency),
      ],
    ),
  ],
  'invoice lines': async (tx) => [
    ['Invoice', 'Kind', 'Description', 'Quantity', 'Price', 'Amount'],
    ...(await tx.select({ line: invoiceLines, number: invoices.number, currency: invoices.currency }).from(invoiceLines).innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId)).orderBy(asc(invoices.id), asc(invoiceLines.position))).map(
      ({ line, number, currency }) => [number, line.kind, line.description, line.minutes === null ? line.quantity / 1000 : hours(line.minutes), money(line.unitPrice, currency), money(line.amount, currency)],
    ),
  ],
  payments: async (tx) => [
    ['Invoice', 'Date', 'Amount', 'Currency', 'Method', 'Reference', 'Simulated'],
    ...(await tx.select({ payment: payments, number: invoices.number, currency: invoices.currency }).from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId)).orderBy(asc(payments.paidOn), asc(payments.id))).map(
      ({ payment, number, currency }) => [number, payment.paidOn, money(payment.amount, currency), currency, payment.method, payment.reference, yes(payment.provider === 'simulated')],
    ),
  ],
}

export const exportNames = Object.keys(tables)

export async function exportTable(ctx: AppContext, actor: Actor, name: string): Promise<Table | null> {
  requireAdministrator(actor)
  const read = Object.hasOwn(tables, name) ? tables[name] : undefined
  if (!read) return null
  return runTransaction(ctx.db, async (tx) => {
    await logChange(tx, actor, { action: 'exported', type: 'settings', id: null, summary: `Exported ${name}` })
    return read(tx, (await getSettings(tx)).currency)
  })
}
