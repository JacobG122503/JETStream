/** A problem the administrator can fix; the message is shown on its own, without a stack trace. */
export class StartupError extends Error {}

/** An error whose status, code and message are sent to the API client as they are. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
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
