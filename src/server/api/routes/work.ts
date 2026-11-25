import { projectTypes } from '../../../shared/domain'
import { requireActor } from '../../auth/access'
import { createClient, listClients, readClient } from '../../work/clients'
import { createExpense, deleteExpense, listExpenses, readExpenseOptions, updateExpense } from '../../work/expenses'
import { readHome } from '../../work/home'
import { addPayment, createInvoice, listInvoices, listUnbilled, markSent, readInvoice, removeDraft } from '../../work/invoices'
import { createProject, listProjects, readProject, readProjectOptions } from '../../work/projects'
import { readTimeReport } from '../../work/reports'
import { createTask, listTasks } from '../../work/tasks'
import { readTeamWeek } from '../../work/team'
import { copyPreviousDay, createEntry, deleteEntry, readTimeOptions, readWeek, startTimer, stopTimer, submitWeek, updateEntry, withdrawWeek } from '../../work/time'
import { jsonBody } from '../body'
import { currency, date, dayMinutes, flag, id, ids, money, oneOf, optional, optionalFlag, pathId, positive, readInput, text, thingName, version } from '../input'
import type { AddRoutes } from './types'

const entry = { projectId: id, taskId: id, spentOn: date, minutes: dayMinutes, notes: text(2000) }
const expense = {
  projectId: id, categoryId: id, spentOn: date, amount: money, quantity: optional(positive), notes: text(2000), billable: flag, reimbursable: flag,
}

/** Home, time, projects, clients, expenses, invoices and reports. */
export const workRoutes: AddRoutes = (api, access, ctx) => {
  api.get('/home', access.signedIn, async (_req, res) => {
    res.json(await readHome(ctx, requireActor(res)))
  })

  api.get('/time', access.signedIn, async (req, res) => {
    res.json(await readWeek(ctx, requireActor(res), readInput(req.query, { date: optional(date) }).date))
  })

  api.get('/time/options', access.signedIn, async (_req, res) => {
    res.json(await readTimeOptions(ctx.db, requireActor(res)))
  })

  api.post('/time', access.signedIn, jsonBody, async (req, res) => {
    const { start, ...input } = readInput(req.body, { ...entry, start: optionalFlag })
    await createEntry(ctx, requireActor(res), input, start)
    res.status(201).json(await readWeek(ctx, requireActor(res), input.spentOn))
  })

  api.post('/time/stop', access.signedIn, async (_req, res) => {
    await stopTimer(ctx, requireActor(res))
    res.json({})
  })

  api.post('/time/submit', access.signedIn, jsonBody, async (req, res) => {
    const input = readInput(req.body, { date })
    await submitWeek(ctx, requireActor(res), input.date)
    res.json(await readWeek(ctx, requireActor(res), input.date))
  })

  api.post('/time/withdraw', access.signedIn, jsonBody, async (req, res) => {
    const input = readInput(req.body, { date })
    await withdrawWeek(ctx, requireActor(res), input.date)
    res.json(await readWeek(ctx, requireActor(res), input.date))
  })

  api.post('/time/copy', access.signedIn, jsonBody, async (req, res) => {
    const input = readInput(req.body, { date, withHours: optionalFlag })
    await copyPreviousDay(ctx, requireActor(res), input.date, input.withHours)
    res.json(await readWeek(ctx, requireActor(res), input.date))
  })

  api.get('/team', access.permission('people.view'), async (req, res) => {
    res.json(await readTeamWeek(ctx, requireActor(res), readInput(req.query, { date: optional(date) }).date))
  })

  api.get('/tasks', access.permission('tasks.manage'), async (_req, res) => {
    res.json({ tasks: await listTasks(ctx.db, requireActor(res)) })
  })

  api.post('/tasks', access.permission('tasks.manage'), jsonBody, async (req, res) => {
    await createTask(ctx, requireActor(res), readInput(req.body, { name: thingName, billable: flag, common: flag }))
    res.status(201).json({ tasks: await listTasks(ctx.db, requireActor(res)) })
  })

  api.put('/time/:id', access.signedIn, jsonBody, async (req, res) => {
    const input = readInput(req.body, { ...entry, version })
    await updateEntry(ctx, requireActor(res), pathId(req.params.id), input)
    res.json(await readWeek(ctx, requireActor(res), input.spentOn))
  })

  api.post('/time/:id/start', access.signedIn, jsonBody, async (req, res) => {
    await startTimer(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { version }).version)
    res.json({})
  })

  api.post('/time/:id/delete', access.signedIn, jsonBody, async (req, res) => {
    await deleteEntry(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { version }).version)
    res.json({})
  })

  api.get('/projects', access.signedIn, async (_req, res) => {
    res.json({ projects: await listProjects(ctx, requireActor(res)) })
  })

  api.get('/projects/options', access.permission('projects.create'), async (_req, res) => {
    res.json(await readProjectOptions(ctx.db, requireActor(res)))
  })

  api.post('/projects', access.permission('projects.create'), jsonBody, async (req, res) => {
    const input = readInput(req.body, {
      clientId: id, name: thingName, code: text(30), type: oneOf(...projectTypes), rate: optional(money), fixedFee: optional(money),
      budgetMinutes: optional(positive), taskIds: ids, personIds: ids,
    })
    res.status(201).json({ id: await createProject(ctx, requireActor(res), input) })
  })

  api.get('/projects/:id', access.signedIn, async (req, res) => {
    res.json(await readProject(ctx, requireActor(res), pathId(req.params.id)))
  })

  api.get('/clients', access.permission('clients.view'), async (_req, res) => {
    res.json(await listClients(ctx.db, requireActor(res)))
  })

  api.post('/clients', access.permission('clients.manage'), jsonBody, async (req, res) => {
    const input = readInput(req.body, { name: thingName, currency, address: text(500) })
    res.status(201).json({ id: await createClient(ctx, requireActor(res), input) })
  })

  api.get('/clients/:id', access.permission('clients.view'), async (req, res) => {
    res.json(await readClient(ctx, requireActor(res), pathId(req.params.id)))
  })

  api.get('/expenses', access.signedIn, async (_req, res) => {
    res.json({ expenses: await listExpenses(ctx, requireActor(res)) })
  })

  api.get('/expenses/options', access.signedIn, async (_req, res) => {
    res.json(await readExpenseOptions(ctx.db, requireActor(res)))
  })

  api.post('/expenses', access.signedIn, jsonBody, async (req, res) => {
    await createExpense(ctx, requireActor(res), readInput(req.body, expense))
    res.status(201).json({ expenses: await listExpenses(ctx, requireActor(res)) })
  })

  api.put('/expenses/:id', access.signedIn, jsonBody, async (req, res) => {
    await updateExpense(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { ...expense, version }))
    res.json({ expenses: await listExpenses(ctx, requireActor(res)) })
  })

  api.post('/expenses/:id/delete', access.signedIn, jsonBody, async (req, res) => {
    await deleteExpense(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { version }).version)
    res.json({ expenses: await listExpenses(ctx, requireActor(res)) })
  })

  api.get('/invoices', access.permission('invoices.manage'), async (_req, res) => {
    res.json(await listInvoices(ctx, requireActor(res)))
  })

  api.get('/invoices/unbilled', access.permission('invoices.manage'), async (req, res) => {
    res.json({ clients: await listUnbilled(ctx.db, requireActor(res), readInput(req.query, { from: optional(date), to: optional(date) })) })
  })

  api.post('/invoices', access.permission('invoices.manage'), jsonBody, async (req, res) => {
    const input = readInput(req.body, {
      clientId: id, projectIds: ids, from: optional(date), to: optional(date), grouping: oneOf('task', 'person', 'project', 'detailed'),
      withExpenses: flag, subject: text(200),
    })
    res.status(201).json({ id: await createInvoice(ctx, requireActor(res), input) })
  })

  api.get('/invoices/:id', access.permission('invoices.manage'), async (req, res) => {
    res.json(await readInvoice(ctx, requireActor(res), pathId(req.params.id)))
  })

  api.post('/invoices/:id/send', access.permission('invoices.manage'), jsonBody, async (req, res) => {
    const invoiceId = pathId(req.params.id)
    await markSent(ctx, requireActor(res), invoiceId, readInput(req.body, { version }).version)
    res.json(await readInvoice(ctx, requireActor(res), invoiceId))
  })

  api.post('/invoices/:id/payments', access.permission('payments.manage'), jsonBody, async (req, res) => {
    const invoiceId = pathId(req.params.id)
    const input = readInput(req.body, {
      amount: positive, paidOn: date, method: oneOf('check', 'bank_transfer', 'card', 'cash', 'other'), reference: text(100),
    })
    await addPayment(ctx, requireActor(res), invoiceId, input)
    res.status(201).json(await readInvoice(ctx, requireActor(res), invoiceId))
  })

  api.post('/invoices/:id/delete', access.permission('invoices.manage'), jsonBody, async (req, res) => {
    await removeDraft(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { version }).version)
    res.json({})
  })

  api.get('/reports/time', access.signedIn, async (req, res) => {
    const { from, to, active } = readInput(req.query, { from: date, to: date, active: optional(oneOf('1')) })
    res.json(await readTimeReport(ctx, requireActor(res), { from, to, activeOnly: active !== null }))
  })
}
