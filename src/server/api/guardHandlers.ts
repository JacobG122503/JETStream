import type { RequestHandler, Router } from 'express'

/**
 * Express takes some thrown values for control flow: `throw null` means "carry on" and
 * `throw 'route'` means "skip this route", so both would end in a 404. This makes every thrown
 * value an error. Call it once all routes are added; it includes routers inside the router.
 */
export function guardHandlers(router: Pick<Router, 'stack'>): void {
  for (const layer of router.stack) {
    if (layer.route) {
      guardHandlers(layer.route)
    } else if (isRouter(layer.handle)) {
      guardHandlers(layer.handle)
    } else if (layer.handle.length <= 3) {
      // Four parameters make an error handler, which is left alone.
      layer.handle = guard(layer.handle)
    }
  }
}

function isRouter(handler: RequestHandler): handler is Router {
  return 'stack' in handler && Array.isArray(handler.stack)
}

function guard(handler: RequestHandler): RequestHandler {
  const guarded: RequestHandler = async (req, res, next) => {
    try {
      await handler(req, res, next)
    } catch (error) {
      if (error instanceof Error) throw error
      throw new Error('A value that is not an error was thrown', { cause: error })
    }
  }
  // Keeps what marks a handler, such as its access level.
  return Object.assign(guarded, handler)
}
