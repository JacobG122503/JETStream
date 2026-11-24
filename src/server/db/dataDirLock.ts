import { readFile, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { errorCode, StartupError } from '../errors'

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) === 'EPERM'
  }
}

/**
 * Makes sure only this process has the data directory open: two processes would corrupt it.
 * A lock left by a process that no longer runs is taken over. Waits a little for another
 * process to finish, which is what happens when the development server restarts.
 */
export async function lockDataDir(dataDir: string, waitMs = 5000): Promise<() => Promise<void>> {
  const lockFile = `${dataDir}.lock`
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      await writeFile(lockFile, String(process.pid), { flag: 'wx' })
      return () => rm(lockFile, { force: true })
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
    const owner = Number(await readFile(lockFile, 'utf8').catch(() => ''))
    if (owner > 0 && !isRunning(owner)) {
      await rm(lockFile, { force: true })
    } else if (Date.now() > deadline) {
      throw new StartupError(
        `The embedded database in ${dataDir} is in use by process ${owner}. Stop it first; ` +
          `if it is not JET Time, delete ${lockFile}.`,
      )
    } else {
      await delay(100)
    }
  }
}
