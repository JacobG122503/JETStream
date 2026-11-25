import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** 256 random bits, in 43 characters that need no escaping. */
export const newToken = () => randomBytes(32).toString('base64url')

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

/** What the database holds. The token is random, so a plain hash cannot be reversed by guessing. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Bound to the session: made from its token, which it does not reveal. */
export const csrfTokenFor = (sessionToken: string) => createHmac('sha256', sessionToken).update('csrf').digest('base64url')

export function sameText(a: string, b: string): boolean {
  const [x, y] = [Buffer.from(a), Buffer.from(b)]
  return x.length === y.length && timingSafeEqual(x, y)
}
