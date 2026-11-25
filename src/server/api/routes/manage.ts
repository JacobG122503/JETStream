import express from 'express'
import { photoLimits } from '../../../shared/accounts'
import {
  budgetTypes, currencyPlacements, dateFormats, hourFormats, numberFormats, paymentTerms, personKinds, projectTypes, rateKinds, rateMethods,
  roundingModes, timeFormats, timeModes,
} from '../../../shared/domain'
import { requireActor } from '../../auth/access'
import { ApiError } from '../../errors'
import { listActivity } from '../../work/activity'
import { archiveClient, createClient, deleteClient, deleteContact, listClients, readClient, saveContact, updateClient } from '../../work/clients'
import { archivePerson, createPerson, deletePerson, deleteRate, readPersonWork, saveRate, updatePerson } from '../../work/people'
import { archiveProject, deleteProject, duplicateProject, pinProject, saveProjectTasks, saveProjectTeam, updateProject } from '../../work/projectEdit'
import { createProject, listProjects, readProject, readProjectOptions } from '../../work/projects'
import { readLogo, readSettings, saveLogo, saveSettings } from '../../work/settings'
import { addToAllProjects, archiveTask, createTask, deleteTask, listTasks, updateTask } from '../../work/tasks'
import { bodyReader, jsonBody } from '../body'
import {
  currency, date, flag, id, ids, integers, listOf, money, newEmail, oneOf, optional, optionalEmail, optionalFlag, optionalText, pathId, percent,
  personName, positive, readInput, text, thingName, timeZone, version, whole,
} from '../input'
import type { AddRoutes } from './types'

const logoBody = bodyReader(express.raw({ type: () => true, limit: photoLimits.bytes }))

const tax = { tax1Name: optionalText(40), tax1Percent: optional(percent), tax2Name: optionalText(40), tax2Percent: optional(percent) }
const terms = { paymentTerms: oneOf(...paymentTerms), paymentTermDays: optional(whole(0, 730)) }
const client = { name: thingName, currency, address: text(500), notes: text(5000), discountPercent: optional(percent), ...tax, ...terms }
const contact = {
  name: thingName, title: text(120), email: optionalEmail, officePhone: optionalText(60), mobilePhone: optionalText(60), version: optional(version),
}
const names = (value: unknown): string[] => listOf({ name: thingName }, 50)(Array.isArray(value) ? value.map((name: unknown) => ({ name })) : value).map(({ name }) => name)
const project = {
  version, name: thingName, code: text(30), startsOn: optional(date), endsOn: optional(date), notes: text(5000), tags: names, budgetMinutes: optional(positive),
  budgetMonthly: flag, budgetIncludesExpenses: flag, budgetVisibleToAll: flag, budgetAlertPercent: optional(percent), type: oneOf(...projectTypes),
  rateMethod: oneOf(...rateMethods), rate: optional(money), fixedFee: optional(money), budgetType: oneOf(...budgetTypes), budgetAmount: optional(positive),
}
const person = {
  name: personName, email: newEmail, phone: optionalText(60), kind: oneOf(...personKinds), weeklyCapacityMinutes: whole(0, 10_080), startedOn: optional(date),
  department: text(80), notes: optionalText(5000), labels: names,
}
const rate = { kind: oneOf(...rateKinds), startsOn: date, rate: money, version: optional(version) }
const task = { name: thingName, billable: flag, common: flag }
const settings = {
  version, name: thingName, address: text(500), currency, timeZone, weekStartsOn: whole(0, 6), fiscalYearStartMonth: whole(1, 12), dateFormat: oneOf(...dateFormats),
  timeFormat: oneOf(...timeFormats), numberFormat: oneOf(...numberFormats), currencyPlacement: oneOf(...currencyPlacements), hourFormat: oneOf(...hourFormats),
  timeMode: oneOf(...timeModes), roundingMode: oneOf(...roundingModes), roundingMinutes: (value: unknown) => Number(oneOf('5', '6', '10', '15', '30')(String(value))) as 5 | 6 | 10 | 15 | 30,
  timeNotesRequired: flag, expenseNotesRequired: flag, approvalEnabled: flag, reminderWeekday: optional(whole(0, 6)), reminderMinute: whole(0, 1439), lockAfterDays: optional(whole(0, 365)), lockedThrough: optional(date),
  expensesEnabled: flag, invoicesEnabled: flag, estimatesEnabled: flag, timeOffEnabled: flag, schedulingEnabled: flag, ...tax, ...terms,
  invoiceNotes: text(2000), estimateNotes: text(2000), estimateValidDays: whole(0, 365), reminderDays: integers(0, 365),
}

/** Settings, clients, projects, tasks and people's work. */
export const manageRoutes: AddRoutes = (api, access, ctx) => {
  api.get('/settings', access.permission('settings.manage'), async (_req, res) => {
    res.json(await readSettings(ctx.db, requireActor(res)))
  })
  api.put('/settings', access.permission('settings.manage'), jsonBody, async (req, res) => {
    await saveSettings(ctx, requireActor(res), readInput(req.body, settings))
    res.json(await readSettings(ctx.db, requireActor(res)))
  })
  api.put('/settings/logo', access.permission('settings.manage'), logoBody, async (req, res) => {
    const upload: unknown = req.body
    if (!Buffer.isBuffer(upload) || upload.length === 0) throw new ApiError(400, 'bad_image', 'Choose a picture.')
    await saveLogo(ctx, requireActor(res), upload)
    res.json(await readSettings(ctx.db, requireActor(res)))
  })
  api.delete('/settings/logo', access.permission('settings.manage'), async (_req, res) => {
    await saveLogo(ctx, requireActor(res), null)
    res.json(await readSettings(ctx.db, requireActor(res)))
  })
  api.get('/logo', access.public, async (_req, res) => {
    const { mediaType, content } = await readLogo(ctx.db)
    res.set('Content-Type', mediaType).set('Content-Disposition', 'inline').send(content)
  })

  api.get('/activity', access.permission('activity.view'), async (req, res) => {
    const filter = readInput(req.query, { from: optional(date), to: optional(date), type: optionalText(40), search: text(100) })
    res.json(await listActivity(ctx.db, requireActor(res), { ...filter, personId: null }))
  })

  // Clients
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
  api.put('/clients/:id', access.permission('clients.manage'), jsonBody, async (req, res) => {
    const clientId = pathId(req.params.id)
    await updateClient(ctx, requireActor(res), clientId, readInput(req.body, { ...client, version }))
    res.json(await readClient(ctx, requireActor(res), clientId))
  })
  api.post('/clients/:id/archive', access.permission('clients.manage'), jsonBody, async (req, res) => {
    await archiveClient(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { archive: flag }).archive)
    res.json({})
  })
  api.delete('/clients/:id', access.permission('clients.manage'), async (req, res) => {
    await deleteClient(ctx, requireActor(res), pathId(req.params.id))
    res.json({})
  })
  api.post('/clients/:id/contacts', access.permission('clients.manage'), jsonBody, async (req, res) => {
    await saveContact(ctx, requireActor(res), pathId(req.params.id), null, readInput(req.body, contact))
    res.status(201).json({})
  })
  api.put('/clients/:id/contacts/:contactId', access.permission('clients.manage'), jsonBody, async (req, res) => {
    await saveContact(ctx, requireActor(res), pathId(req.params.id), pathId(req.params.contactId), readInput(req.body, contact))
    res.json({})
  })
  api.delete('/clients/:id/contacts/:contactId', access.permission('clients.manage'), async (req, res) => {
    await deleteContact(ctx, requireActor(res), pathId(req.params.id), pathId(req.params.contactId))
    res.json({})
  })

  // Projects
  api.get('/projects', access.signedIn, async (_req, res) => {
    res.json({ projects: await listProjects(ctx, requireActor(res)) })
  })
  // Whoever creates or edits projects; the service decides.
  api.get('/projects/options', access.signedIn, async (_req, res) => {
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
  api.put('/projects/:id', access.permission('projects.edit'), jsonBody, async (req, res) => {
    await updateProject(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, project))
    res.json(await readProject(ctx, requireActor(res), pathId(req.params.id)))
  })
  api.put('/projects/:id/tasks', access.permission('projects.edit'), jsonBody, async (req, res) => {
    const { tasks } = readInput(req.body, {
      tasks: listOf({ taskId: id, billable: flag, rate: optional(money), budgetMinutes: optional(positive), budgetAmount: optional(positive) }, 200),
    })
    await saveProjectTasks(ctx, requireActor(res), pathId(req.params.id), tasks)
    res.json(await readProject(ctx, requireActor(res), pathId(req.params.id)))
  })
  api.put('/projects/:id/team', access.permission('projects.edit'), jsonBody, async (req, res) => {
    const { members } = readInput(req.body, { members: listOf({ personId: id, rate: optional(money), budgetMinutes: optional(positive), isManager: flag }, 500) })
    await saveProjectTeam(ctx, requireActor(res), pathId(req.params.id), members)
    res.json(await readProject(ctx, requireActor(res), pathId(req.params.id)))
  })
  api.post('/projects/:id/archive', access.permission('projects.edit'), jsonBody, async (req, res) => {
    await archiveProject(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { archive: flag }).archive)
    res.json({})
  })
  api.delete('/projects/:id', access.permission('projects.edit'), async (req, res) => {
    await deleteProject(ctx, requireActor(res), pathId(req.params.id))
    res.json({})
  })
  api.post('/projects/:id/duplicate', access.permission('projects.create'), jsonBody, async (req, res) => {
    const input = readInput(req.body, { clientId: id, name: thingName, code: text(30), withTeam: optionalFlag })
    res.status(201).json({ id: await duplicateProject(ctx, requireActor(res), pathId(req.params.id), input) })
  })
  api.post('/projects/:id/pin', access.signedIn, jsonBody, async (req, res) => {
    await pinProject(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { pin: flag }).pin)
    res.json({})
  })

  // Tasks
  api.get('/tasks', access.permission('tasks.manage'), async (_req, res) => {
    res.json({ tasks: await listTasks(ctx.db, requireActor(res)) })
  })
  api.post('/tasks', access.permission('tasks.manage'), jsonBody, async (req, res) => {
    const { defaultRate, ...input } = readInput(req.body, { ...task, defaultRate: optional(money) })
    await createTask(ctx, requireActor(res), { ...input, ...('defaultRate' in (req.body as object) && { defaultRate }) })
    res.status(201).json({ tasks: await listTasks(ctx.db, requireActor(res)) })
  })
  api.put('/tasks/:id', access.permission('tasks.manage'), jsonBody, async (req, res) => {
    const taskId = pathId(req.params.id)
    const { defaultRate, ...input } = readInput(req.body, { ...task, version, defaultRate: optional(money) })
    await updateTask(ctx, requireActor(res), taskId, { ...input, ...('defaultRate' in (req.body as object) && { defaultRate }) })
    res.json({ tasks: await listTasks(ctx.db, requireActor(res)) })
  })
  api.post('/tasks/:id/archive', access.permission('tasks.manage'), jsonBody, async (req, res) => {
    await archiveTask(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { archive: flag }).archive)
    res.json({ tasks: await listTasks(ctx.db, requireActor(res)) })
  })
  api.post('/tasks/:id/add-to-all', access.permission('tasks.manage'), async (req, res) => {
    res.json({ added: await addToAllProjects(ctx, requireActor(res), pathId(req.params.id)) })
  })
  api.delete('/tasks/:id', access.permission('tasks.manage'), async (req, res) => {
    await deleteTask(ctx, requireActor(res), pathId(req.params.id))
    res.json({ tasks: await listTasks(ctx.db, requireActor(res)) })
  })

  // People's work
  api.post('/people', access.permission('people.manage'), jsonBody, async (req, res) => {
    const input = readInput(req.body, { ...person, clientIds: ids, projectIds: ids })
    res.status(201).json({ id: await createPerson(ctx, requireActor(res), input) })
  })
  api.get('/people/:id/work', access.permission('people.view'), async (req, res) => {
    res.json(await readPersonWork(ctx.db, requireActor(res), pathId(req.params.id)))
  })
  api.put('/people/:id', access.permission('people.manage'), jsonBody, async (req, res) => {
    await updatePerson(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { ...person, version }))
    res.json(await readPersonWork(ctx.db, requireActor(res), pathId(req.params.id)))
  })
  api.post('/people/:id/archive', access.permission('people.manage'), jsonBody, async (req, res) => {
    await archivePerson(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { archive: flag }).archive)
    res.json({})
  })
  api.delete('/people/:id', access.permission('people.manage'), async (req, res) => {
    await deletePerson(ctx, requireActor(res), pathId(req.params.id))
    res.json({})
  })
  // Rates: the service asks for billable.edit or cost.edit.
  api.post('/people/:id/rates', access.permission('people.view'), jsonBody, async (req, res) => {
    const personId = pathId(req.params.id)
    await saveRate(ctx, requireActor(res), personId, null, readInput(req.body, rate))
    res.status(201).json(await readPersonWork(ctx.db, requireActor(res), personId))
  })
  api.put('/people/:id/rates/:rateId', access.permission('people.view'), jsonBody, async (req, res) => {
    const personId = pathId(req.params.id)
    await saveRate(ctx, requireActor(res), personId, pathId(req.params.rateId), readInput(req.body, rate))
    res.json(await readPersonWork(ctx.db, requireActor(res), personId))
  })
  api.delete('/people/:id/rates/:rateId', access.permission('people.view'), async (req, res) => {
    const personId = pathId(req.params.id)
    await deleteRate(ctx, requireActor(res), personId, pathId(req.params.rateId))
    res.json(await readPersonWork(ctx.db, requireActor(res), personId))
  })
}
