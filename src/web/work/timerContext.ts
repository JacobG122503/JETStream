import { createContext, useContext } from 'react'
import type { TimeEntry } from '../../shared/work'

export interface Timer {
  running: TimeEntry | null
  /** The server's clock ahead of the device's, in milliseconds. */
  ahead: number
  /** Counts up whenever one's time changed by the timer, so that pages load again. */
  changes: number
  start: (entry: Pick<TimeEntry, 'id' | 'version'>) => Promise<void>
  /** A new entry with the same project, task and notes, running from now. */
  again: (entry: Pick<TimeEntry, 'projectId' | 'taskId' | 'notes'>) => Promise<void>
  stop: () => Promise<void>
  /** Asks the server what is running. */
  refresh: () => void
}

export const TimerContext = createContext<Timer>({
  running: null, ahead: 0, changes: 0, start: () => Promise.resolve(), again: () => Promise.resolve(), stop: () => Promise.resolve(), refresh: () => undefined,
})

export const useTimer = () => useContext(TimerContext)
