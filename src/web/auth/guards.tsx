import { Fragment, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { PlainLayout } from '../shell/PlainLayout'
import { useDocumentTitle } from '../shell/useDocumentTitle'
import { ErrorState, LoadingState, PageHeader } from '../ui'
import { WaitingPage } from '../pages/auth/WaitingPage'
import { type Auth, useAuth } from './authContext'
import { signInPath } from './returnPath'

/** What is shown while it is not known who is signed in; null once it is. */
function Undecided({ auth }: { auth: Auth }) {
  useDocumentTitle(auth.status === 'failed' ? 'Cannot reach the server' : 'Loading')
  if (auth.status === 'loading') return <LoadingState size="page" label="Loading JET Time" />
  return (
    <>
      <PageHeader title="Cannot reach the server" />
      <ErrorState
        size="page"
        headingLevel={2}
        title="JET Time does not answer"
        message="Check your connection and try again."
        retryLabel="Try again"
        onRetry={() => void auth.refresh()}
      />
    </>
  )
}

/** Pages for people who are signed in and approved. Everyone else is led to sign in, or to wait. */
export function RequireActive({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const location = useLocation()
  const { info, left } = auth
  if (!info) {
    return (
      <PlainLayout>
        <Undecided auth={auth} />
      </PlainLayout>
    )
  }
  if (!info.person) {
    // Whoever signed out on purpose starts afresh.
    if (left?.how === 'signed-out') return <Navigate to="/sign-in" replace />
    const state = left?.how === 'ended' ? { endedFor: left.personId } : null
    return <Navigate to={signInPath(location)} replace state={state} />
  }
  if (info.person.status !== 'active') {
    return (
      <PlainLayout>
        <WaitingPage />
      </PlainLayout>
    )
  }
  // Nothing that was loaded for one person is kept for another.
  return <Fragment key={info.person.id}>{children}</Fragment>
}

/** Pages that make sense only while nobody is signed in. */
export function SignedOutOnly({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (!auth.info) return <Undecided auth={auth} />
  if (auth.info.person) return <Navigate to="/" replace />
  return <>{children}</>
}

/** Pages that work either way, once it is known who is signed in. */
export function KnownSession({ children }: { children: ReactNode }) {
  const auth = useAuth()
  return auth.info ? <>{children}</> : <Undecided auth={auth} />
}
