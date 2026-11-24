import { sql } from 'drizzle-orm'
import type { RequestHandler } from 'express'
import type { Db } from '../db/database'
import { errorCode, withTimeout } from '../errors'

const timeoutMs = 3000

export function health(db: Db): RequestHandler {
  return async (_req, res) => {
    try {
      await withTimeout(
        (async () => db.execute(sql`select 1`))(),
        timeoutMs,
        'The database did not answer in time',
      )
    } catch (error) {
      console.error(`Health check: database unavailable (${errorCode(error) ?? 'no code'}).`)
      res.status(503).json({ status: 'error', database: 'unavailable' })
      return
    }
    res.json({ status: 'ok', database: 'ok' })
  }
}
