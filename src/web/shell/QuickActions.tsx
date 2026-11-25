import { useNavigate } from 'react-router-dom'
import { Button, IconButton } from '../ui'
import { Clock } from '../work/Clock'
import { useTimer } from '../work/timerContext'

/** What people do most, above the navigation. */
export function QuickActions() {
  const navigate = useNavigate()
  const { running, stop } = useTimer()
  return (
    <div className="nav-quick" role="group" aria-label="Quick actions">
      {running ? (
        <Button variant="primary" icon="stop" aria-label={`Stop: ${running.task}, ${running.project}`} title={`${running.task}, ${running.project}`} onClick={() => void stop()}>
          <Clock entry={running} />
        </Button>
      ) : (
        <Button variant="primary" icon="timer" onClick={() => navigate('/time?new=timer')}>
          Timer
        </Button>
      )}
      <IconButton icon="timeAdd" label="Add time" onClick={() => navigate('/time?new=time')} />
      <IconButton icon="expenseAdd" label="Add an expense" onClick={() => navigate('/expenses?new=1')} />
    </div>
  )
}
