import express from 'express'
import { type NotificationKind, notificationKinds } from '../../../shared/notifications'
import { requireActor } from '../../auth/access'
import { ApiError } from '../../errors'
import { approvalPath, approversOf, approveWeek, approveWeeks, forceSubmit, listApprovals, lockThrough, rejectWeek, remind, reopenWeek, unlockPeriod } from '../../work/approvals'
import {
  addReceipt, archiveCategory, createExpense, deleteExpense, listCategories, listExpenses, listTeamExpenses, readExpenseOptions, readReceiptFile, receiptBytes, removeReceipt,
  saveCategory, setReimbursed, updateExpense,
} from '../../work/expenses'
import { exportNames, exportTable } from '../../work/exports'
import { readHome } from '../../work/home'
import { listNotifications, listPreferences, markRead, notify, savePreference } from '../../work/notify'
import { listOutbox } from '../../work/outbox'
import { readContractorReport, readProfitReport } from '../../work/profit'
import { readDetailedTime, readExpenseReport, readPaymentReport, readTimeReport } from '../../work/reports'
import { deleteSavedReport, listSavedReports, saveReport } from '../../work/savedReports'
import { readTeamWeek } from '../../work/team'
import {
  copyPreviousDay, createEntry, deleteEntry, readMonth, readTimeOptions, readWeek, removeFavorite, saveFavorite, startTimer, stopTimer, submitWeek, updateEntry, withdrawWeek,
} from '../../work/time'
import { bodyReader, jsonBody } from '../body'
import { date, dayMinutes, flag, id, ids, money, oneOf, optional, optionalFlag, optionalId, optionalText, pathId, positive, readInput, text, thingName, version } from '../input'
import type { AddRoutes } from './types'

const entry = {
  projectId: id, taskId: id, spentOn: date, minutes: dayMinutes, startMinute: optional(dayMinutes), endMinute: optional(dayMinutes), notes: text(2000),
}
const month = (value: unknown): string => date(`${String(value)}-01`).slice(0, 7)
const queryId = (value: unknown): number | null => (value === undefined || value === '' ? null : pathId(value))
const receiptBody = bodyReader(express.raw({ type: () => true, limit: receiptBytes }))
const category = { name: thingName, unitName: optionalText(30), unitPrice: optional(money), version: optional(version) }
const expense = {
  projectId: id, categoryId: id, spentOn: date, amount: money, quantity: optional(positive), notes: text(2000), billable: flag, reimbursable: flag,
}

/** Home, time, projects, clients, expenses, invoices and reports. */
export const workRoutes: AddRoutes = (api, access, ctx) => {
  const dates = (query: unknown) => readInput(query, { from: date, to: date })

  api.get('/home', access.signedIn, async (_req, res) => {
    res.json(await readHome(ctx, requireActor(res)))
  })

  api.get('/time', access.signedIn, async (req, res) => {
    const { date: day, person } = readInput(req.query, { date: optional(date), person: queryId })
    res.json(await readWeek(ctx, requireActor(res), day, person))
  })

  api.get('/time/month', access.signedIn, async (req, res) => {
    const input = readInput(req.query, { month, person: queryId })
    res.json(await readMonth(ctx.db, requireActor(res), input.month, input.person))
  })

  api.post('/time/favorites', access.signedIn, jsonBody, async (req, res) => {
    await saveFavorite(ctx.db, requireActor(res), readInput(req.body, { projectId: id, taskId: id, notes: text(2000) }))
    res.status(201).json(await readTimeOptions(ctx.db, requireActor(res)))
  })

  api.delete('/time/favorites/:id', access.signedIn, async (req, res) => {
    await removeFavorite(ctx.db, requireActor(res), pathId(req.params.id))
    res.json(await readTimeOptions(ctx.db, requireActor(res)))
  })

  api.get('/time/options', access.signedIn, async (req, res) => {
    res.json(await readTimeOptions(ctx.db, requireActor(res), readInput(req.query, { person: queryId }).person))
  })

  api.post('/time', access.signedIn, jsonBody, async (req, res) => {
    const { start, personId, ...input } = readInput(req.body, { ...entry, start: optionalFlag, personId: optionalId })
    await createEntry(ctx, requireActor(res), input, start, personId)
    res.status(201).json(await readWeek(ctx, requireActor(res), input.spentOn, personId))
  })

  api.post('/time/stop', access.signedIn, async (_req, res) => {
    await stopTimer(ctx, requireActor(res))
    res.json({})
  })

  api.post('/time/submit', access.signedIn, jsonBody, async (req, res) => {
    const input = readInput(req.body, { date })
    const actor = requireActor(res)
    const { from, projectIds } = await submitWeek(ctx, actor, input.date)
    await notify(ctx, await approversOf(ctx.db, actor.id, projectIds), {
      kind: 'approval', title: `${actor.name} submitted a week`, body: `The week from ${from} is waiting for approval.`, path: approvalPath(from),
    })
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

  api.put('/time/:id', access.signedIn, jsonBody, async (req, res) => {
    const { personId, ...input } = readInput(req.body, { ...entry, version, personId: optionalId })
    await updateEntry(ctx, requireActor(res), pathId(req.params.id), input)
    res.json(await readWeek(ctx, requireActor(res), input.spentOn, personId))
  })

  api.post('/time/:id/start', access.signedIn, jsonBody, async (req, res) => {
    await startTimer(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { version }).version)
    res.json({})
  })

  api.post('/time/:id/delete', access.signedIn, jsonBody, async (req, res) => {
    await deleteEntry(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { version }).version)
    res.json({})
  })

  api.get('/expenses', access.signedIn, async (_req, res) => {
    res.json({ expenses: await listExpenses(ctx, requireActor(res)) })
  })

  api.get('/expenses/options', access.signedIn, async (_req, res) => {
    res.json(await readExpenseOptions(ctx.db, requireActor(res)))
  })

  api.post('/expenses', access.signedIn, jsonBody, async (req, res) => {
    const made = await createExpense(ctx, requireActor(res), readInput(req.body, expense))
    res.status(201).json({ id: made, expenses: await listExpenses(ctx, requireActor(res)) })
  })

  api.put('/expenses/:id', access.signedIn, jsonBody, async (req, res) => {
    await updateExpense(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { ...expense, version }))
    res.json({ expenses: await listExpenses(ctx, requireActor(res)) })
  })

  api.post('/expenses/:id/delete', access.signedIn, jsonBody, async (req, res) => {
    await deleteExpense(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { version }).version)
    res.json({ expenses: await listExpenses(ctx, requireActor(res)) })
  })

  api.get('/reports/time', access.signedIn, async (req, res) => {
    const { from, to, active, department, fixed } = readInput(req.query, { from: date, to: date, active: optional(oneOf('1')), department: text(80), fixed: optional(oneOf('1')) })
    res.json(await readTimeReport(ctx, requireActor(res), { from, to, activeOnly: active !== null, department, fixedFee: fixed !== null }))
  })

  api.get('/reports/profitability', access.permission('cost.view'), async (req, res) => {
    const { from, to, fixed } = readInput(req.query, { from: date, to: date, fixed: optional(oneOf('1')) })
    res.json(await readProfitReport(ctx, requireActor(res), { from, to, fixedFee: fixed !== null }))
  })

  api.get('/reports/contractors', access.permission('time.view'), async (req, res) => {
    res.json(await readContractorReport(ctx, requireActor(res), dates(req.query)))
  })

  api.get('/reports/saved', access.signedIn, async (_req, res) => {
    res.json({ reports: await listSavedReports(ctx.db, requireActor(res)) })
  })

  api.post('/reports/saved', access.signedIn, jsonBody, async (req, res) => {
    await saveReport(ctx.db, requireActor(res), readInput(req.body, { name: thingName, path: text(2000) }))
    res.status(201).json({ reports: await listSavedReports(ctx.db, requireActor(res)) })
  })

  api.delete('/reports/saved/:id', access.signedIn, async (req, res) => {
    await deleteSavedReport(ctx.db, requireActor(res), pathId(req.params.id))
    res.json({ reports: await listSavedReports(ctx.db, requireActor(res)) })
  })

  api.get('/reports/detailed', access.signedIn, async (req, res) => {
    res.json(await readDetailedTime(ctx, requireActor(res), dates(req.query)))
  })

  api.get('/reports/expenses', access.signedIn, async (req, res) => {
    res.json(await readExpenseReport(ctx, requireActor(res), dates(req.query)))
  })

  api.get('/reports/payments', access.permission('invoices.manage'), async (req, res) => {
    res.json(await readPaymentReport(ctx, requireActor(res), dates(req.query)))
  })

  api.get('/export', access.administrator, (_req, res) => {
    res.json({ tables: exportNames })
  })

  api.get('/export/:name', access.administrator, async (req, res) => {
    const rows = await exportTable(ctx, requireActor(res), String(req.params.name))
    if (!rows) throw new ApiError(404, 'not_found', 'Not found')
    res.json({ rows })
  })

  // Receipts. A file never runs as a page of this app.
  api.put('/expenses/:id/receipts/:version', access.signedIn, receiptBody, async (req, res) => {
    const upload: unknown = req.body
    if (!Buffer.isBuffer(upload) || upload.length === 0) throw new ApiError(400, 'bad_file', 'Choose a file.')
    await addReceipt(ctx, requireActor(res), pathId(req.params.id), pathId(req.params.version), upload)
    res.json({ expenses: await listExpenses(ctx, requireActor(res)) })
  })

  api.post('/expenses/:id/receipts/:fileId/delete', access.signedIn, jsonBody, async (req, res) => {
    await removeReceipt(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { version }).version, pathId(req.params.fileId))
    res.json({ expenses: await listExpenses(ctx, requireActor(res)) })
  })

  api.get('/expenses/:id/receipts/:fileId', access.signedIn, async (req, res) => {
    const { name, mediaType, content } = await readReceiptFile(ctx.db, requireActor(res), pathId(req.params.id), pathId(req.params.fileId))
    res.set('Content-Type', mediaType).set('Content-Disposition', `${mediaType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${name.replace(/[^\w.-]/g, '')}"`).send(content)
  })

  api.get('/expenses/team', access.permission('time.view'), async (req, res) => {
    res.json(await listTeamExpenses(ctx.db, requireActor(res), readInput(req.query, { from: date, to: date })))
  })

  api.post('/expenses/reimburse', access.permission('expenses.reimburse'), jsonBody, async (req, res) => {
    const input = readInput(req.body, { ids, paidOn: optional(date) })
    res.json({ changed: await setReimbursed(ctx, requireActor(res), input.ids, input.paidOn) })
  })

  api.get('/expense-categories', access.permission('tasks.manage'), async (_req, res) => {
    res.json({ categories: await listCategories(ctx.db, requireActor(res)) })
  })

  api.post('/expense-categories', access.permission('tasks.manage'), jsonBody, async (req, res) => {
    await saveCategory(ctx, requireActor(res), null, readInput(req.body, category))
    res.status(201).json({ categories: await listCategories(ctx.db, requireActor(res)) })
  })

  api.put('/expense-categories/:id', access.permission('tasks.manage'), jsonBody, async (req, res) => {
    await saveCategory(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, category))
    res.json({ categories: await listCategories(ctx.db, requireActor(res)) })
  })

  api.post('/expense-categories/:id/archive', access.permission('tasks.manage'), jsonBody, async (req, res) => {
    await archiveCategory(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { archive: flag }).archive)
    res.json({ categories: await listCategories(ctx.db, requireActor(res)) })
  })

  // Approvals
  api.get('/approvals', access.permission('time.approve'), async (req, res) => {
    const { from, to } = dates(req.query)
    res.json(await listApprovals(ctx, requireActor(res), from, to))
  })

  api.post('/approvals/approve', access.permission('time.approve'), jsonBody, async (req, res) => {
    res.json({ approved: await approveWeeks(ctx, requireActor(res), readInput(req.body, { ids }).ids) })
  })

  api.post('/approvals/submit', access.permission('time.approve'), jsonBody, async (req, res) => {
    const input = readInput(req.body, { personIds: ids, from: date, to: date })
    res.json(await forceSubmit(ctx, requireActor(res), input.personIds, input.from, input.to))
  })

  api.post('/approvals/lock', access.permission('settings.manage'), jsonBody, async (req, res) => {
    await lockThrough(ctx, requireActor(res), readInput(req.body, { through: date }).through)
    res.json({})
  })

  api.post('/approvals/:id/approve', access.permission('time.approve'), async (req, res) => {
    await approveWeek(ctx, requireActor(res), pathId(req.params.id))
    res.json({})
  })

  api.post('/approvals/:id/reject', access.permission('time.approve'), jsonBody, async (req, res) => {
    await rejectWeek(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { comment: text(1000) }).comment)
    res.json({})
  })

  api.post('/approvals/:id/reopen', access.permission('time.unlock'), async (req, res) => {
    await reopenWeek(ctx, requireActor(res), pathId(req.params.id))
    res.json({})
  })

  api.post('/approvals/unlock', access.permission('time.unlock'), jsonBody, async (req, res) => {
    const input = readInput(req.body, { personId: id, date })
    await unlockPeriod(ctx, requireActor(res), input.personId, input.date)
    res.json({})
  })

  api.post('/approvals/remind', access.permission('time.approve'), jsonBody, async (req, res) => {
    const input = readInput(req.body, { personIds: ids, date })
    res.json({ reminded: await remind(ctx, requireActor(res), input.personIds, input.date) })
  })

  // Email
  api.get('/outbox', access.permission('outbox.view'), async (req, res) => {
    res.json(await listOutbox(ctx.db, requireActor(res), readInput(req.query, { search: text(100) }).search))
  })

  // Notifications
  api.get('/notifications', access.signedIn, async (_req, res) => {
    res.json(await listNotifications(ctx.db, requireActor(res)))
  })

  api.post('/notifications/read', access.signedIn, jsonBody, async (req, res) => {
    await markRead(ctx, requireActor(res), readInput(req.body, { id: optionalId }).id)
    res.json(await listNotifications(ctx.db, requireActor(res)))
  })

  api.get('/notifications/preferences', access.signedIn, async (_req, res) => {
    res.json({ preferences: await listPreferences(ctx.db, requireActor(res)) })
  })

  api.put('/notifications/preferences', access.signedIn, jsonBody, async (req, res) => {
    const kinds = Object.keys(notificationKinds) as NotificationKind[]
    await savePreference(ctx.db, requireActor(res), readInput(req.body, { kind: oneOf(...kinds), inApp: flag, email: flag }))
    res.json({ preferences: await listPreferences(ctx.db, requireActor(res)) })
  })
}
