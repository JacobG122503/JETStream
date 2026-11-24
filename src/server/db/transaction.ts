import { setTimeout as delay } from 'node:timers/promises'
import { errorCode } from '../errors'
import type { Db, Tx } from './database'

/** Serialization failure and deadlock: the same work can succeed when tried again. */
const retryable = new Set(['40001', '40P01'])
const maxAttempts = 3

/**
 * Runs the work in one transaction: any error undoes everything. The work may run up to three
 * times, so it must do nothing outside the database. Inside it use `tx` only; the embedded
 * database has one connection, and `db` would wait for it forever.
 */
export async function runTransaction<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(work)
    } catch (error) {
      if (attempt >= maxAttempts || !retryable.has(errorCode(error) ?? '')) throw error
      // Lets the other transaction finish, instead of meeting it again at once.
      await delay(10 * attempt * (1 + Math.random()))
    }
  }
}
