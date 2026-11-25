import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TimeWeek } from '../../shared/work'
import { callApi, errorMessage } from '../api'
import { useToast } from '../ui'
import { type Timer, TimerContext } from './timerContext'

/** Knows the running timer, for the header and the pages. */
export function TimerProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [state, setState] = useState<Pick<Timer, 'running' | 'ahead'>>({ running: null, ahead: 0 })
  const [today, setToday] = useState('')
  const [changes, setChanges] = useState(0)
  const busy = useRef(false)

  const load = useCallback(async () => {
    const week = await callApi<TimeWeek>('GET', 'time')
    setState({ running: week.running, ahead: Date.parse(week.now) - Date.now() })
    setToday(week.today)
  }, [])
  const refresh = useCallback(() => {
    // What is not known is not shown; the page itself tells what is wrong.
    load().catch(() => undefined)
  }, [load])
  useEffect(refresh, [refresh])

  const timer = useMemo<Timer>(() => {
    const change = async (work: () => Promise<unknown>) => {
      if (busy.current) return
      busy.current = true
      try {
        await work()
        await load()
        setChanges((count) => count + 1)
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        busy.current = false
      }
    }
    return {
      ...state, changes, refresh,
      start: ({ id, version }) => change(() => callApi('POST', `time/${id}/start`, { version })),
      again: ({ projectId, taskId, notes }) => change(() => callApi('POST', 'time', { projectId, taskId, notes, spentOn: today, minutes: 0, start: true })),
      stop: () => change(() => callApi('POST', 'time/stop')),
    }
  }, [state, changes, today, refresh, load, toast])

  return <TimerContext.Provider value={timer}>{children}</TimerContext.Provider>
}
