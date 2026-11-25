import type { ApiErrorBody } from '../shared/api'
import { apiUrl } from './basePath'

/** What the server, or the way to it, answered instead of a result. The message is for people. */
export class ApiError extends Error {
  override name = 'ApiError'
  constructor(
    /** 0 when the server could not be reached. */
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
  }
}

/** The part of the app that knows who is signed in. */
export interface ApiSession {
  csrfToken: () => string | null
  /** What the person may do, as the server last said it. */
  access: () => string | null
  /** The person may now do something else than was known. */
  onAccessChanged: () => void
  /** The server refused because of who is signed in. True to send the request once more. */
  onRefused: (code: string) => Promise<boolean>
}

let session: ApiSession = { csrfToken: () => null, access: () => null, onAccessChanged: () => undefined, onRefused: () => Promise.resolve(false) }

export function connectApi(connected: ApiSession) {
  session = connected
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

const refusals = ['unauthenticated', 'csrf', 'pending_approval']

/** Calls the API. A body is sent as JSON, or as it is when it is a Blob. */
export async function callApi<T>(method: Method, route: string, body?: object): Promise<T> {
  try {
    return await send<T>(method, route, body)
  } catch (error) {
    if (!(error instanceof ApiError) || !refusals.includes(error.code)) throw error
    if (!(await session.onRefused(error.code))) throw error
    return send<T>(method, route, body)
  }
}

async function send<T>(method: Method, route: string, body?: object): Promise<T> {
  const headers: Record<string, string> = {}
  const token = session.csrfToken()
  if (method !== 'GET' && token !== null) headers['X-CSRF-Token'] = token
  const raw = body instanceof Blob
  if (body !== undefined) headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json'
  let response: Response
  let text: string
  try {
    response = await fetch(apiUrl(route), {
      method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), credentials: 'same-origin',
    })
    text = await response.text()
  } catch {
    throw new ApiError(0, 'unreachable', 'The server cannot be reached. Check your connection and try again.')
  }
  const now = response.headers.get('X-Access')
  const known = session.access()
  if (now !== null && known !== null && now !== known) session.onAccessChanged()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ApiError(response.status, 'unreadable', 'The server gave an answer that could not be read. Try again.')
  }
  if (response.ok) return data as T
  const { error } = data as Partial<ApiErrorBody>
  throw new ApiError(
    response.status,
    error?.code ?? 'unknown',
    error ? messageFor(error) : 'Something went wrong. Try again.',
    error?.fields,
    error?.retryAfterSeconds,
  )
}

function messageFor({ code, message, retryAfterSeconds }: ApiErrorBody['error']): string {
  if (code !== 'too_many_attempts' || retryAfterSeconds === undefined) return message
  const minutes = Math.ceil(retryAfterSeconds / 60)
  const at = new Date(Date.now() + retryAfterSeconds * 1000)
  const time = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(at)
  return `Too many attempts. Try again in ${minutes === 1 ? '1 minute' : `${minutes} minutes`}, at ${time}.`
}

/** What to tell someone about any failure. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.'
}
