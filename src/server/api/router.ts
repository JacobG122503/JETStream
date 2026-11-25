import { type ErrorRequestHandler, Router } from 'express'
import { type Access, createAccess, declaredRoutes } from '../auth/access'
import type { AppContext } from '../context'
import { BillingError, type BillingProblem, ClaimError, EntryLockedError } from '../billing'
import { ApiError, clientError, describeError, NotFoundError, StaleError } from '../errors'
import { guardHandlers } from './guardHandlers'
import { health } from './health'
import { accessRoutes } from './routes/access'
import { accountRoutes } from './routes/account'
import { inviteRoutes } from './routes/invites'
import { linkRoutes } from './routes/links'
import { peopleRoutes } from './routes/people'
import { requestRoutes } from './routes/requests'
import { sessionRoutes } from './routes/session'
import { workRoutes } from './routes/work'

export interface ApiOptions {
  /** Adds routes; used by tests to reach the error handling. */
  extend?: (api: Router, access: Access) => void
}

/**
 * Everything under /api. Every response is JSON, except photos.
 *
 * Every route begins with its access level: `api.get('/things', access.permission('things.view'), handler)`.
 * A route without one stops the server from starting. Routes with a JSON body then have `jsonBody`.
 */
export function createApiRouter(ctx: AppContext, { extend }: ApiOptions = {}): Router {
  const api = Router({ caseSensitive: true })
  const access = createAccess(ctx)
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  api.get('/health', access.public, health(ctx.db))
  for (const addRoutes of [sessionRoutes, linkRoutes, accountRoutes, peopleRoutes, accessRoutes, requestRoutes, inviteRoutes, workRoutes]) {
    addRoutes(api, access, ctx)
  }
  extend?.(api, access)
  declaredRoutes(api)
  api.use(() => {
    throw new ApiError(404, 'not_found', 'Not found')
  })
  api.use(handleApiError)
  guardHandlers(api)
  return api
}

// Express recognises an error handler by its four parameters.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const handleApiError: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const { status, code, message, more } = toApiError(error, `${req.method} ${routePattern(req.route)}`)
  if (res.headersSent) {
    // Not handed on: Express would log the error with everything in it.
    res.destroy()
    return
  }
  if (more.retryAfterSeconds !== undefined) res.set('Retry-After', String(more.retryAfterSeconds))
  res.status(status).json({ error: { code, message, ...more } })
}

/** The pattern, not the address, which can hold anything. */
function routePattern(route: unknown): string {
  return route instanceof Object && 'path' in route ? String(route.path) : ''
}

const billingMessages: Record<BillingProblem, string> = {
  invoice_not_editable: 'This invoice can no longer be changed.',
  invoice_has_payments: 'This invoice has payments.',
  invoice_not_payable: 'Only an open invoice can be paid.',
  payment_exceeds_due: 'This is more than is due.',
  refund_exceeds_payment: 'More than was paid cannot be given back.',
  amount_not_positive: 'Enter an amount above 0.',
  nothing_to_bill: 'There is no time and there are no expenses to invoice.',
}

function toApiError(error: unknown, where: string): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof StaleError) {
    return new ApiError(409, 'stale', 'Someone else changed this in the meantime. Reload to see the change.')
  }
  if (error instanceof NotFoundError) return new ApiError(404, 'not_found', 'Not found')
  if (error instanceof EntryLockedError) {
    return new ApiError(409, 'locked', error.reason === 'invoiced' ? 'This was invoiced and cannot be changed.' : 'This was approved and cannot be changed.')
  }
  if (error instanceof BillingError) return new ApiError(409, error.problem, billingMessages[error.problem])
  if (error instanceof ClaimError) {
    return new ApiError(409, 'stale', 'Some of the time or expenses changed, or were invoiced, in the meantime. Reload to see what is left.')
  }
  // Express could not decode a route parameter, as in /things/%ff.
  const undecodable = error instanceof URIError ? clientError(error) : undefined
  if (undecodable) return undecodable
  // A status on any other error is not for our client: it may be another service's answer to us.
  console.error(`Unexpected error (${where.trim()})\n${describeError(error)}`)
  return new ApiError(500, 'internal_error', 'Something went wrong')
}
