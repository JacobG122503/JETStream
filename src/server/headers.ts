import type { RequestHandler } from 'express'

/** Pictures may also come from the page itself: a photo is shown before it is uploaded. */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** On every answer, whatever it is. */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    'Content-Security-Policy': contentSecurityPolicy,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  })
  next()
}
