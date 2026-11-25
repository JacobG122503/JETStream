import type { AppContext } from '../context'
import { describeError, withTimeout } from '../errors'
import { removeOldInviteLinks } from '../people/invites'
import { removeOldResets } from '../people/resets'
import { removeOldAttempts } from './limits'
import { removeOldSessions } from './sessions'

/** Removes what has expired: sessions, links, and attempts that no longer count. */
export async function cleanUp({ db, now }: Pick<AppContext, 'db' | 'now'>): Promise<void> {
  const at = now()
  await removeOldSessions(db, at)
  await removeOldResets(db, at)
  await removeOldInviteLinks(db, at)
  await removeOldAttempts(db, at)
}

const everyMs = 30 * 60_000

/** Cleans up now and then from time to time. The result stops it, waiting only briefly. */
export async function startCleaning(ctx: Pick<AppContext, 'db' | 'now'>): Promise<() => Promise<void>> {
  let running = Promise.resolve()
  let stopped = false
  const run = () => {
    running = running
      .then(() => (stopped ? undefined : cleanUp(ctx)))
      .catch((error: unknown) => console.error(`Removing expired records failed.\n${describeError(error)}`))
    return running
  }
  await run()
  const timer = setInterval(() => void run(), everyMs)
  timer.unref()
  return async () => {
    stopped = true
    clearInterval(timer)
    await withTimeout(running, 1000, 'still cleaning up').catch(() => undefined)
  }
}
