import { useAuth, useCan, usePerson } from '../auth/authContext'
import { RunningTimer } from '../work/RunningTimer'
import { TimerProvider } from '../work/TimerProvider'
import { AccountMenu } from './AccountMenu'
import { AppShell } from './AppShell'
import { NotificationBell } from './NotificationBell'
import { QuickActions } from './QuickActions'

/** The shell for someone who is signed in, with the sections they may open. */
export function SignedInShell() {
  const can = useCan()
  const { access } = usePerson()
  const { info } = useAuth()
  const modules = info?.company.formats.modules
  return (
    <TimerProvider>
      <AppShell
        headerContent={
          <>
            <RunningTimer />
            <NotificationBell />
            <AccountMenu />
          </>
        }
        navTop={<QuickActions />}
        navCorner={<NotificationBell />}
        navFoot={<AccountMenu />}
        contentKey={access}
        isNavItemVisible={({ needs, module }) => (needs === undefined || needs.some((key) => can(key))) && (module === undefined || modules?.[module] !== false)}
      />
    </TimerProvider>
  )
}
