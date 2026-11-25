/** Who may use a route. Each route begins with one of these; see api/router.ts. */
import type { RequestHandler, Response, Router } from 'express'
import type { AppContext } from '../context'
import { ApiError } from '../errors'
import { type CurrentSession, isAdministrator, loadSession } from './sessions'
import { sameText } from './tokens'

export const accessLevels = ['public', 'signedIn', 'administrator'] as const
export type AccessLevel = (typeof accessLevels)[number]
export type Access = Record<AccessLevel, RequestHandler>

/** Marks the handlers made here, so that a list of all routes can be checked. */
const levelMark = Symbol('access level')

export function createAccess(ctx: AppContext): Access {
  const create = (level: AccessLevel): RequestHandler => {
    const check: RequestHandler = async (req, res, next) => {
      const changes = req.method !== 'GET' && req.method !== 'HEAD'
      if (changes) checkOrigin(ctx, req.get('Origin'), `${req.protocol}://${req.headers.host}`)
      if (level !== 'public' || changes) {
        const session = await loadSession(ctx, req)
        if (changes && session && !sameText(req.get('X-CSRF-Token') ?? '', session.csrfToken)) throw csrfError()
        if (level !== 'public') checkLevel(level, session)
        ;(res.locals as Locals).session = session
      }
      next()
    }
    return Object.assign(check, { [levelMark]: level })
  }
  return { public: create('public'), signedIn: create('signedIn'), administrator: create('administrator') }
}

function checkLevel(level: 'signedIn' | 'administrator', session: CurrentSession | undefined) {
  if (!session) throw new ApiError(401, 'unauthenticated', 'Sign in first')
  if (session.person.status !== 'active') throw new ApiError(403, 'pending_approval', 'An administrator must approve your account first')
  if (level === 'administrator' && !isAdministrator(session)) {
    throw new ApiError(403, 'forbidden', 'You do not have access to this')
  }
}

const csrfError = () => new ApiError(403, 'csrf', 'The request did not come from this page. Reload and try again.')

function checkOrigin(ctx: AppContext, origin: string | undefined, sentTo: string) {
  if (origin === undefined || origin === new URL(ctx.publicUrl).origin) return
  if (ctx.acceptHostOrigin && origin === sentTo) return
  throw csrfError()
}

interface Locals {
  session?: CurrentSession
}

/** The session of a request to a route that changes something, if there is one. */
export const sessionOf = (res: Response): CurrentSession | undefined => (res.locals as Locals).session

/** The session of a request to a route that needs one. */
export function requireSession(res: Response): CurrentSession {
  const session = sessionOf(res)
  if (!session) throw new Error('The route has no access level that gives a session')
  return session
}

export interface DeclaredRoute {
  method: string
  path: string
  level: AccessLevel
}

/** All routes of a router and the routers in it. Throws for one that does not begin with an access level. */
export function declaredRoutes(router: Pick<Router, 'stack'>, prefix = ''): DeclaredRoute[] {
  const found: DeclaredRoute[] = []
  for (const layer of router.stack) {
    if (layer.route) {
      const path = prefix + String(layer.route.path)
      const first = new Map<string, RequestHandler>()
      for (const { method, handle } of layer.route.stack) {
        const name = (method as string | undefined) ?? 'all'
        if (!first.has(name)) first.set(name, handle)
      }
      for (const [method, handle] of first) {
        const level = levelMark in handle ? (handle[levelMark] as AccessLevel) : undefined
        if (!level) throw new Error(`The route ${method.toUpperCase()} ${path} has no access level`)
        found.push({ method, path, level })
      }
    } else if ('stack' in layer.handle && Array.isArray(layer.handle.stack)) {
      found.push(...declaredRoutes(layer.handle as unknown as Router, prefix))
    }
  }
  return found
}
