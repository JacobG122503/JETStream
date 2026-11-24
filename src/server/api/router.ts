import express, { type ErrorRequestHandler, type RequestHandler, Router } from 'express'
import type { Db } from '../db/database'
import { ApiError, clientError } from '../errors'
import { guardHandlers } from './guardHandlers'
import { health } from './health'

export interface ApiOptions {
  db: Db
  /** Adds routes; used by tests to reach the error handling. */
  extend?: (api: Router) => void
}

/** Everything under /api. Every response is JSON. */
export function createApiRouter({ db, extend }: ApiOptions): Router {
  const api = Router({ caseSensitive: true })
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  api.use(bodyReader(express.json()))
  api.get('/health', health(db))
  extend?.(api)
  api.use(() => {
    throw new ApiError(404, 'not_found', 'Not found')
  })
  api.use(handleApiError)
  guardHandlers(api)
  return api
}

/** Wraps middleware that reads the request, so that what it refuses is the client's error. */
function bodyReader(read: RequestHandler): RequestHandler {
  return (req, res, next) =>
    read(req, res, (error?: unknown) => {
      if (error === undefined) next()
      else next(clientError(error) ?? error)
    })
}

// Express recognises an error handler by its four parameters.
export const handleApiError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error)
    return
  }
  const { status, code, message } = toApiError(error)
  res.status(status).json({ error: { code, message } })
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  // Express could not decode a route parameter, as in /things/%ff.
  const undecodable = error instanceof URIError ? clientError(error) : undefined
  if (undecodable) return undecodable
  // A status on any other error is not for our client: it may be another service's answer to us.
  console.error(error)
  return new ApiError(500, 'internal_error', 'Something went wrong')
}
