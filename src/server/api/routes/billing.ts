import express, { type RequestHandler } from 'express'
import { requireActor } from '../../auth/access'
import { ApiError } from '../../errors'
import { readClientFile, readClientInvoice } from '../../work/clientInvoices'
import { answererName, estimateReaders, invoiceReaders, messageReaders, readDocumentOptions, recurringReaders } from '../../work/documents'
import {
  answerAsClient, createEstimate, createEstimateLink, deleteEstimate, draftEstimateMessage, duplicateEstimate, invoiceFromEstimate, listEstimates, markEstimateSent, projectFromEstimate,
  readClientEstimate, readEstimate, recordAnswer, revokeEstimateLinks, sendEstimate, updateEstimate,
} from '../../work/estimates'
import { addUnbilled, createInvoice, listInvoices, listUnbilled, readInvoice } from '../../work/invoices'
import {
  addPayment, attachFile, attachmentBytes, attachReceipts, backToDraft, createFreeInvoice, createLink, detachFile, draftMessage, duplicateInvoice, markSent, payFromRetainer, readAttachedFile,
  refundPayment, removeInvoice, removePayment, reopen, revokeLinks, sendMessage, updateInvoice, writeOff,
} from '../../work/invoiceWork'
import { createRecurring, deleteRecurring, listRecurring, readRecurring, setRecurringStatus, updateRecurring } from '../../work/recurring'
import { addRetainerEntry, createRetainer, listRetainers, readRetainer, readStatement, setRetainerStatus } from '../../work/retainers'
import { bodyReader, jsonBody } from '../body'
import { anything, date, flag, id, ids, oneOf, optional, optionalId, pathId, positive, readInput, signedMoney, text, thingName, version } from '../input'
import { withLinkLimit } from './links'
import type { AddRoutes } from './types'

const period = { projectIds: ids, from: optional(date), to: optional(date), grouping: oneOf('task', 'person', 'project', 'detailed'), withExpenses: flag }
const fileBody = bodyReader(express.raw({ type: () => true, limit: attachmentBytes }))

/** Invoices, estimates, recurring invoices, retainers, and what clients see of them. */
export const billingRoutes: AddRoutes = (api, access, ctx) => {
  const invoices = access.permission('invoices.manage')
  const payments = access.permission('payments.manage')
  const estimates = access.permission('estimates.manage')

  api.get('/documents/options', access.signedIn, async (_req, res) => {
    res.json(await readDocumentOptions(ctx, requireActor(res)))
  })

  // Invoices
  api.get('/invoices', invoices, async (_req, res) => {
    res.json(await listInvoices(ctx, requireActor(res)))
  })

  api.get('/invoices/unbilled', invoices, async (req, res) => {
    res.json({ clients: await listUnbilled(ctx.db, requireActor(res), readInput(req.query, { from: optional(date), to: optional(date) })) })
  })

  api.post('/invoices', invoices, jsonBody, async (req, res) => {
    res.status(201).json({ id: await createInvoice(ctx, requireActor(res), readInput(req.body, { clientId: id, ...period, subject: text(200) })) })
  })

  api.post('/invoices/free', invoices, jsonBody, async (req, res) => {
    res.status(201).json({ id: await createFreeInvoice(ctx, requireActor(res), readInput(req.body, invoiceReaders)) })
  })

  api.get('/invoices/:id', invoices, async (req, res) => {
    res.json(await readInvoice(ctx, requireActor(res), pathId(req.params.id)))
  })

  /** Changes an invoice, and answers with how it is then. */
  const change = (path: string, level: RequestHandler, work: (actor: ReturnType<typeof requireActor>, invoiceId: number, body: unknown) => Promise<unknown>) => {
    api.post(`/invoices/:id/${path}`, level, jsonBody, async (req, res) => {
      const invoiceId = pathId(req.params.id)
      await work(requireActor(res), invoiceId, req.body)
      res.json(await readInvoice(ctx, requireActor(res), invoiceId))
    })
  }
  const versionOf = (body: unknown) => readInput(body, { version }).version

  api.put('/invoices/:id', invoices, jsonBody, async (req, res) => {
    const invoiceId = pathId(req.params.id)
    await updateInvoice(ctx, requireActor(res), invoiceId, readInput(req.body, { ...invoiceReaders, version }))
    res.json(await readInvoice(ctx, requireActor(res), invoiceId))
  })

  api.post('/invoices/:id/duplicate', invoices, async (req, res) => {
    res.status(201).json({ id: await duplicateInvoice(ctx, requireActor(res), pathId(req.params.id)) })
  })

  api.post('/invoices/:id/delete', invoices, jsonBody, async (req, res) => {
    await removeInvoice(ctx, requireActor(res), pathId(req.params.id), versionOf(req.body))
    res.json({})
  })

  change('send', invoices, (actor, invoiceId, body) => markSent(ctx, actor, invoiceId, versionOf(body)))
  change('draft', invoices, (actor, invoiceId, body) => backToDraft(ctx, actor, invoiceId, versionOf(body)))
  change('write-off', payments, (actor, invoiceId, body) => {
    const input = readInput(body, { version, reason: text(500) })
    return writeOff(ctx, actor, invoiceId, input.version, input.reason)
  })
  change('reopen', payments, (actor, invoiceId, body) => reopen(ctx, actor, invoiceId, versionOf(body)))
  change('add', invoices, (actor, invoiceId, body) => {
    const { version: seen, ...input } = readInput(body, { ...period, version })
    return addUnbilled(ctx, actor, invoiceId, seen, input)
  })

  api.get('/invoices/:id/message', invoices, async (req, res) => {
    const { kind } = readInput(req.query, { kind: oneOf('sent', 'reminder', 'thank_you') })
    res.json(await draftMessage(ctx, requireActor(res), pathId(req.params.id), kind))
  })

  change('messages', invoices, (actor, invoiceId, body) => {
    const { version: seen, ...message } = readInput(body, { ...messageReaders, version })
    return sendMessage(ctx, actor, invoiceId, seen, message)
  })

  api.post('/invoices/:id/link', invoices, async (req, res) => {
    res.status(201).json({ link: await createLink(ctx, requireActor(res), pathId(req.params.id)) })
  })

  change('revoke-links', invoices, (actor, invoiceId) => revokeLinks(ctx, actor, invoiceId))
  change('attach-receipts', invoices, (actor, invoiceId) => attachReceipts(ctx, actor, invoiceId))

  api.put('/invoices/:id/attachments', invoices, fileBody, async (req, res) => {
    const upload: unknown = req.body
    const { name } = readInput(req.query, { name: text(200) })
    if (!Buffer.isBuffer(upload) || upload.length === 0) throw new ApiError(400, 'bad_file', 'Choose a file.')
    const invoiceId = pathId(req.params.id)
    await attachFile(ctx, requireActor(res), invoiceId, name, upload)
    res.json(await readInvoice(ctx, requireActor(res), invoiceId))
  })

  api.get('/invoices/:id/attachments/:fileId', invoices, async (req, res) => {
    const { name, mediaType, content } = await readAttachedFile(ctx.db, requireActor(res), pathId(req.params.id), pathId(req.params.fileId))
    res.set('Content-Type', mediaType).set('Content-Disposition', `attachment; filename="${name.replace(/[^\w. -]/g, '')}"`).send(content)
  })

  change('detach', invoices, (actor, invoiceId, body) => detachFile(ctx, actor, invoiceId, readInput(body, { fileId: id }).fileId))

  // Money
  change('payments', payments, (actor, invoiceId, body) =>
    addPayment(ctx, actor, invoiceId, readInput(body, { amount: positive, paidOn: date, method: oneOf('check', 'bank_transfer', 'card', 'cash', 'other'), reference: text(100), notes: text(500) })))
  change('pay-from-retainer', payments, (actor, invoiceId, body) => {
    const { retainerId, amount } = readInput(body, { retainerId: id, amount: positive })
    return payFromRetainer(ctx, actor, invoiceId, retainerId, amount)
  })
  change('remove-payment', payments, (actor, invoiceId, body) => removePayment(ctx, actor, invoiceId, readInput(body, { paymentId: id }).paymentId))
  change('refund', payments, (actor, invoiceId, body) => {
    const { paymentId, ...input } = readInput(body, { paymentId: id, amount: positive, refundedOn: date, reason: text(500) })
    return refundPayment(ctx, actor, invoiceId, paymentId, input)
  })

  // Recurring invoices
  api.get('/recurring', invoices, async (_req, res) => {
    res.json(await listRecurring(ctx.db, requireActor(res)))
  })

  api.post('/recurring', invoices, jsonBody, async (req, res) => {
    res.status(201).json({ id: await createRecurring(ctx, requireActor(res), readInput(req.body, recurringReaders)) })
  })

  api.get('/recurring/:id', invoices, async (req, res) => {
    res.json(await readRecurring(ctx, requireActor(res), pathId(req.params.id)))
  })

  api.put('/recurring/:id', invoices, jsonBody, async (req, res) => {
    await updateRecurring(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { ...recurringReaders, version }))
    res.json(await readRecurring(ctx, requireActor(res), pathId(req.params.id)))
  })

  api.post('/recurring/:id/status', invoices, jsonBody, async (req, res) => {
    await setRecurringStatus(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { status: oneOf('active', 'paused', 'ended') }).status)
    res.json(await readRecurring(ctx, requireActor(res), pathId(req.params.id)))
  })

  api.delete('/recurring/:id', invoices, async (req, res) => {
    await deleteRecurring(ctx, requireActor(res), pathId(req.params.id))
    res.json({})
  })

  // Retainers and statements
  api.get('/retainers', payments, async (_req, res) => {
    res.json(await listRetainers(ctx.db, requireActor(res)))
  })

  api.post('/retainers', payments, jsonBody, async (req, res) => {
    res.status(201).json({ id: await createRetainer(ctx, requireActor(res), readInput(req.body, { clientId: id, projectId: optionalId, name: thingName })) })
  })

  api.get('/retainers/:id', payments, async (req, res) => {
    res.json(await readRetainer(ctx.db, requireActor(res), pathId(req.params.id)))
  })

  api.post('/retainers/:id/entries', payments, jsonBody, async (req, res) => {
    const input = readInput(req.body, { kind: oneOf('top_up', 'refund', 'adjustment'), amount: signedMoney, on: date, notes: text(500), invoiceId: optionalId })
    await addRetainerEntry(ctx, requireActor(res), pathId(req.params.id), input)
    res.status(201).json(await readRetainer(ctx.db, requireActor(res), pathId(req.params.id)))
  })

  api.post('/retainers/:id/status', payments, jsonBody, async (req, res) => {
    await setRetainerStatus(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { status: oneOf('active', 'closed') }).status)
    res.json(await readRetainer(ctx.db, requireActor(res), pathId(req.params.id)))
  })

  api.get('/clients/:id/statement', invoices, async (req, res) => {
    res.json(await readStatement(ctx, requireActor(res), pathId(req.params.id)))
  })

  // Estimates
  api.get('/estimates', estimates, async (_req, res) => {
    res.json(await listEstimates(ctx, requireActor(res)))
  })

  api.post('/estimates', estimates, jsonBody, async (req, res) => {
    res.status(201).json({ id: await createEstimate(ctx, requireActor(res), readInput(req.body, estimateReaders)) })
  })

  api.get('/estimates/:id', estimates, async (req, res) => {
    res.json(await readEstimate(ctx, requireActor(res), pathId(req.params.id)))
  })

  api.put('/estimates/:id', estimates, jsonBody, async (req, res) => {
    await updateEstimate(ctx, requireActor(res), pathId(req.params.id), readInput(req.body, { ...estimateReaders, version }))
    res.json(await readEstimate(ctx, requireActor(res), pathId(req.params.id)))
  })

  api.post('/estimates/:id/delete', estimates, jsonBody, async (req, res) => {
    await deleteEstimate(ctx, requireActor(res), pathId(req.params.id), versionOf(req.body))
    res.json({})
  })

  api.post('/estimates/:id/duplicate', estimates, async (req, res) => {
    res.status(201).json({ id: await duplicateEstimate(ctx, requireActor(res), pathId(req.params.id)) })
  })

  const changeEstimate = (path: string, work: (actor: ReturnType<typeof requireActor>, estimateId: number, body: unknown) => Promise<unknown>) => {
    api.post(`/estimates/:id/${path}`, estimates, jsonBody, async (req, res) => {
      const estimateId = pathId(req.params.id)
      await work(requireActor(res), estimateId, req.body)
      res.json(await readEstimate(ctx, requireActor(res), estimateId))
    })
  }

  api.get('/estimates/:id/message', estimates, async (req, res) => {
    res.json(await draftEstimateMessage(ctx, requireActor(res), pathId(req.params.id)))
  })

  changeEstimate('send', (actor, estimateId, body) => markEstimateSent(ctx, actor, estimateId, versionOf(body)))
  changeEstimate('messages', (actor, estimateId, body) => {
    const { version: seen, ...message } = readInput(body, { ...messageReaders, version })
    return sendEstimate(ctx, actor, estimateId, seen, message)
  })
  changeEstimate('answer', (actor, estimateId, body) => {
    const { version: seen, ...input } = readInput(body, { version, answer: oneOf('accepted', 'declined'), name: text(120), comment: text(1000) })
    return recordAnswer(ctx, actor, estimateId, seen, input)
  })
  changeEstimate('revoke-links', (actor, estimateId) => revokeEstimateLinks(ctx, actor, estimateId))

  api.post('/estimates/:id/link', estimates, async (req, res) => {
    res.status(201).json({ link: await createEstimateLink(ctx, requireActor(res), pathId(req.params.id)) })
  })

  api.post('/estimates/:id/invoice', estimates, jsonBody, async (req, res) => {
    res.status(201).json({ id: await invoiceFromEstimate(ctx, requireActor(res), pathId(req.params.id), versionOf(req.body)) })
  })

  api.post('/estimates/:id/project', estimates, jsonBody, async (req, res) => {
    const input = readInput(req.body, { version, name: thingName })
    res.status(201).json({ id: await projectFromEstimate(ctx, requireActor(res), pathId(req.params.id), input.version, input.name) })
  })

  // For clients, who have a link and no account. The token is in the body, so that no log has it.
  const token = { token: anything }

  api.post('/client/invoice', access.public, jsonBody, async (req, res) => {
    res.json(await withLinkLimit(ctx, req, () => readClientInvoice(ctx, readInput(req.body, token).token)))
  })

  api.post('/client/invoice/file', access.public, jsonBody, async (req, res) => {
    const input = readInput(req.body, { ...token, fileId: id })
    res.json(await withLinkLimit(ctx, req, () => readClientFile(ctx, input.token, input.fileId)))
  })

  api.post('/client/estimate', access.public, jsonBody, async (req, res) => {
    res.json(await withLinkLimit(ctx, req, () => readClientEstimate(ctx, readInput(req.body, token).token)))
  })

  api.post('/client/estimate/answer', access.public, jsonBody, async (req, res) => {
    const { token: sent, ...input } = readInput(req.body, { ...token, answer: oneOf('accepted', 'declined'), name: answererName, comment: text(1000) })
    res.json(await withLinkLimit(ctx, req, () => answerAsClient(ctx, sent, input)))
  })
}
