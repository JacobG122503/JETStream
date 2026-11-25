import { type ReactNode, useState } from 'react'
import { ApiError, errorMessage } from '../../api'
import { useAuth } from '../../auth/authContext'
import { Button, ErrorState, LinkButton, LoadingState, Notice } from '../../ui'
import { AuthPage } from './AuthPage'

/** For every link that does not work, whatever the reason. */
export function DeadLinkPage() {
  const { info } = useAuth()
  return (
    <AuthPage title="This link no longer works">
      <Notice tone="warning">
        Links work once and for a limited time. Ask an administrator at {info?.company.name} for a new one. If you reloaded this
        page, open the link you were given again.
      </Notice>
      <div className="form-actions">
        <LinkButton to="/sign-in">Go to sign in</LinkButton>
      </div>
    </AuthPage>
  )
}

interface LinkStateProps {
  title: string
  error: unknown
  onRetry: () => void
}

/** While a link is being checked, and when that fails. */
export function LinkState({ title, error, onRetry }: LinkStateProps) {
  if (error instanceof ApiError && error.code === 'link_invalid') return <DeadLinkPage />
  return (
    <AuthPage title={title}>
      {error === null ? (
        <LoadingState label="Checking the link" />
      ) : (
        <ErrorState headingLevel={2} title="The link could not be checked" message={errorMessage(error)} onRetry={onRetry} />
      )}
    </AuthPage>
  )
}

/** Asks whoever is signed in to sign out first. Nothing to do with the link is shown before. */
export function SignOutFirst({ title, what }: { title: string; what: ReactNode }) {
  const { info, signOut } = useAuth()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const leave = async () => {
    setBusy(true)
    try {
      await signOut()
    } catch (error) {
      setProblem(errorMessage(error))
    }
    setBusy(false)
  }
  return (
    <AuthPage title={title}>
      <Notice
        tone="warning"
        title={`You are signed in as ${info?.person?.name}`}
        action={
          <Button icon="signOut" loading={busy} loadingLabel="Signing out" onClick={() => void leave()}>
            Sign out and go on
          </Button>
        }
      >
        {what}
      </Notice>
      {problem !== null && (
        <Notice tone="danger" announce="alert">
          {problem}
        </Notice>
      )}
    </AuthPage>
  )
}
