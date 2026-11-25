import { useEffect, useState } from 'react'
import type { TimeEntry } from '../../shared/work'
import { formatClock } from './format'
import { useTimer } from './timerContext'

const second = 1000

/** The time of a running entry, counting. Not read out every second. */
export function Clock({ entry }: { entry: Pick<TimeEntry, 'minutes' | 'timerStartedAt'> }) {
  const { ahead } = useTimer()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), second)
    return () => clearInterval(timer)
  }, [])
  const started = entry.timerStartedAt === null ? now + ahead : Date.parse(entry.timerStartedAt)
  return <span className="clock">{formatClock(entry.minutes * 60 + (now + ahead - started) / second)}</span>
}
