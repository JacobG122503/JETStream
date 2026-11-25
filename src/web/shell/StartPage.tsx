import { Navigate } from 'react-router-dom'
import { startsAtHome } from '../theme/startPage'

/** Home, unless someone chose to begin with the timesheet. */
export function StartPage() {
  return <Navigate to={startsAtHome() ? '/home' : '/time'} replace />
}
