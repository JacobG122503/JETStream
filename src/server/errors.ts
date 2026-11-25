/** A problem the administrator can fix; the message is shown on its own, without a stack trace. */
export class StartupError extends Error {}

/** An error whose status, code and message are sent to the API client as they are. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly more: ErrorDetails = {},
  ) {
    super(message)
  }
}

export interface ErrorDetails {
  /** What is wrong with each named input. */
  fields?: Record<string, string>
  /** Sent as Retry-After as well. */
  retryAfterSeconds?: number
}

/**
 * What to tell the client about an error from Express's own request reading (body, path, static
 * files), which carries a 4xx status. Not for errors from routes: theirs mean something else.
 */
export function clientError(error: unknown): ApiError | undefined {
  if (error instanceof ApiError) return error
  const status = error instanceof Error && 'status' in error ? error.status : undefined
  if (status === 413) return new ApiError(413, 'payload_too_large', 'The request is too large')
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return new ApiError(status, 'bad_request', 'The request could not be read')
  }
  return undefined
}

/** The code of an error or of what caused it: a SQLSTATE such as 23505, or ECONNREFUSED. */
export function errorCode(error: unknown): string | undefined {
  // Drizzle wraps driver errors, so follow the causes.
  for (let current = error; current instanceof Object; current = (current as Error).cause) {
    if ('code' in current && typeof current.code === 'string') return current.code
  }
  return undefined
}

/**
 * What may be logged about an unexpected error: names, codes and places. Never messages, details
 * or parameters, because those repeat what people typed (an email, a password, a token).
 */
export function describeError(error: unknown): string {
  const lines: string[] = []
  let current = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const name = /^\w{1,60}$/.test(current.name) ? current.name : 'Error'
    const facts = [`${depth > 0 ? 'caused by ' : ''}${name}`]
    if ('code' in current && typeof current.code === 'string' && /^\w{1,40}$/.test(current.code)) facts.push(`code ${current.code}`)
    if ('constraint' in current && typeof current.constraint === 'string') facts.push(`constraint ${current.constraint}`)
    lines.push(facts.join(', '))
    // The stack begins with the message, which can span lines and look like anything.
    const message = current.message
    const stack = current.stack ?? ''
    const end = message === '' ? 0 : stack.indexOf(message) + message.length
    const known = message === '' || stack.includes(message)
    const places = known ? stack.slice(end).split('\n').filter((line) => /^ {4}at /.test(line)) : []
    lines.push(...places.slice(0, 12))
    current = current.cause
  }
  return lines.length > 0 ? lines.join('\n') : 'A value that is not an error was thrown'
}

/** Rejects with `message` if the promise takes longer than `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}
