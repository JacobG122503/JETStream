import { beforeEach, vi } from 'vitest'
import type { SessionInfo } from '../../shared/api'
import { sessionInfo } from './session'

export interface Call {
  method: string
  route: string
  body: unknown
  csrfToken: string | null
}

export const failure = (status: number, code: string, more: object = {}) => ({ status, body: { error: { code, message: code, ...more } } })

type Answer = object | undefined | { status: number; body: object }
type Handler = (call: Call) => Answer | Promise<Answer>

/** Stands in for the API: answers by "METHOD route", and keeps what was asked. */
export function fakeServer() {
  const server = {
    session: sessionInfo(),
    calls: [] as Call[],
    handlers: {} as Record<string, Handler>,
    sent: (what: string) => server.calls.filter(({ method, route }) => `${method} ${route}` === what),
    signIn: (info: SessionInfo) => (server.session = info),
  }
  beforeEach(() => {
    server.session = sessionInfo()
    server.calls = []
    server.handlers = { 'GET session': () => server.session }
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : init.body
      const headers = init.headers as Record<string, string>
      const call = { method: init.method ?? 'GET', route: url.replace('/api/', ''), body, csrfToken: headers['X-CSRF-Token'] ?? null }
      server.calls.push(call)
      const answer = await server.handlers[`${call.method} ${call.route}`]?.(call)
      const { status, body: data } = answer && 'status' in answer && 'body' in answer
        ? (answer as { status: number; body: object })
        : { status: answer === undefined ? 404 : 200, body: answer ?? failure(404, 'not_found').body }
      return new Response(JSON.stringify(data), { status })
    })
    return () => vi.unstubAllGlobals()
  })
  return server
}
