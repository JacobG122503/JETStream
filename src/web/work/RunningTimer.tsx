import { Link } from 'react-router-dom'
import { IconButton } from '../ui'
import { Clock } from './Clock'
import { useTimer } from './timerContext'
import './work.css'

/** The running timer in the header. Nothing while none runs. */
export function RunningTimer() {
  const { running, stop } = useTimer()
  if (!running) return null
  return (
    <div className="running" role="group" aria-label="Running timer">
      <span className="pulse" />
      <Link to="/time" className="running-text">
        <span className="running-what">
          {running.task}, {running.project}
        </span>
        <Clock entry={running} />
      </Link>
      <IconButton icon="stop" size="small" variant="quiet" label="Stop timer" onClick={() => void stop()} />
    </div>
  )
}
