import { useCan, usePerson } from '../auth/authContext'
import { RunningTimer } from '../work/RunningTimer'
import { TimerProvider } from '../work/TimerProvider'
import { AccountMenu } from './AccountMenu'
import { AppShell } from './AppShell'

/** The shell for someone who is signed in, with the sections they may open. */
export function SignedInShell() {
  const can = useCan()
  const { access } = usePerson()
  return (
    <TimerProvider>
      <AppShell
        headerContent={
          <>
            <RunningTimer />
            <AccountMenu />
          </>
        }
        contentKey={access}
        isNavItemVisible={({ needs }) => needs === undefined || needs.some((key) => can(key))}
      />
    </TimerProvider>
  )
}
