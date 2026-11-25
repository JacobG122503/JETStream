/** Who may use a route. Each route begins with one of these; see api/router.ts. */
import type { RequestHandler, Response, Router } from 'express'
import { isPermissionKey, type PermissionKey } from '../../shared/permissions'
import { accessFingerprint, type PersonActor } from '../access/actor'
import { requireAdministrator, requirePermission } from '../access/decisions'
import type { AppContext } from '../context'
import { ApiError } from '../errors'
import { type CurrentSession, loadSession } from './sessions'
import { sameText } from './tokens'

export interface AccessLevel {
  level: 'public' | 'signedIn' | 'administrator' | 'permission'
  /** For level permission. */
  permission?: PermissionKey
  /**
   * Also lets people through who do not hold the permission, to their own records. The service
   * decides which those are.
   */
  orOwner?: boolean
}

export interface Access {
  /** Anyone. */
  public: RequestHandler
  /** Every active person, for what base access covers. */
  signedIn: RequestHandler
  /** The built-in Administrator role only: what no permission gives. */
  administrator: RequestHandler
  /** Whoever holds the permission at any level. The service checks what it is held for. */
  permission: (key: PermissionKey, options?: { orOwner?: boolean }) => RequestHandler
}

/** Marks the handlers made here, so that a list of all routes can be checked. */
const levelMark = Symbol('access level')

/** Tells the web app that what the person may do has changed. */
export const accessHeader = 'X-Access'

export function createAccess(ctx: AppContext): Access {
  const create = (access: AccessLevel): RequestHandler => {
    const isPublic = access.level === 'public'
    const check: RequestHandler = async (req, res, next) => {
      const changes = req.method !== 'GET' && req.method !== 'HEAD'
      if (changes) checkOrigin(ctx, req.get('Origin'), `${req.protocol}://${req.headers.host}`)
      if (!isPublic || changes) {
        const session = await loadSession(ctx, req)
        if (changes && session && !sameText(req.get('X-CSRF-Token') ?? '', session.csrfToken)) throw csrfError()
        if (!isPublic) {
          // Also when it is refused: that is when the app has to know.
          if (session?.person.status === 'active') res.set(accessHeader, accessFingerprint(session.actor))
          checkLevel(access, session)
        }
        ;(res.locals as Locals).session = session
      }
      next()
    }
    return Object.assign(check, { [levelMark]: access })
  }
  return {
    public: create({ level: 'public' }),
    signedIn: create({ level: 'signedIn' }),
    administrator: create({ level: 'administrator' }),
    permission: (permission, { orOwner = false } = {}) => {
      if (!isPermissionKey(permission)) throw new Error(`There is no permission ${String(permission)}`)
      return create({ level: 'permission', permission, orOwner })
    },
  }
}

function checkLevel({ level, permission, orOwner }: AccessLevel, session: CurrentSession | undefined) {
  if (!session) throw new ApiError(401, 'unauthenticated', 'Sign in first')
  if (session.person.status !== 'active') throw new ApiError(403, 'pending_approval', 'An administrator must approve your account first')
  if (level === 'administrator') requireAdministrator(session.actor)
  if (permission && !orOwner) requirePermission(session.actor, permission)
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

/** The acting person of a request to a route that needs one. Services take it and check again. */
export const requireActor = (res: Response): PersonActor => requireSession(res).actor

export interface DeclaredRoute extends AccessLevel {
  method: string
  path: string
}

/**
 * All routes of a router and the routers in it. Throws for one that does not begin with an access
 * level, and for `param` callbacks: they run before the access level and outside the handler guard.
 */
export function declaredRoutes(router: Pick<Router, 'stack'> & { params?: object }, prefix = ''): DeclaredRoute[] {
  const found: DeclaredRoute[] = []
  const [param] = Object.keys(router.params ?? {})
  if (param !== undefined) throw new Error(`A router has a callback for the parameter ${param}. Use a function of the route instead.`)
  for (const layer of router.stack) {
    if (layer.route) {
      const path = prefix + String(layer.route.path)
      const first = new Map<string, RequestHandler>()
      for (const { method, handle } of layer.route.stack) {
        const name = (method as string | undefined) ?? 'all'
        if (!first.has(name)) first.set(name, handle)
      }
      for (const [method, handle] of first) {
        const access = levelMark in handle ? (handle[levelMark] as AccessLevel) : undefined
        if (!access) throw new Error(`The route ${method.toUpperCase()} ${path} has no access level`)
        found.push({ method, path, ...access })
      }
    } else if ('stack' in layer.handle && Array.isArray(layer.handle.stack)) {
      found.push(...declaredRoutes(layer.handle as unknown as Router, prefix))
    }
  }
  return found
}
