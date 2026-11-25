import express, { type RequestHandler } from 'express'
import { ApiError, clientError } from '../errors'

/** Wraps middleware that reads the request, so that what it refuses is the client's error. */
export function bodyReader(read: RequestHandler): RequestHandler {
  return (req, res, next) =>
    read(req, res, (error?: unknown) => {
      if (error === undefined) next()
      else next(clientError(error) ?? error)
    })
}

const readJson = bodyReader(express.json())

/** For routes with a JSON body, after their access level: nothing is read from strangers. */
export const jsonBody: RequestHandler = (req, res, next) => {
  const type = req.get('Content-Type')
  const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0
  if (type === undefined ? hasBody : !/^application\/json\s*(;|$)/i.test(type)) {
    throw new ApiError(415, 'unsupported_media_type', 'The request must be JSON')
  }
  void readJson(req, res, next)
}
