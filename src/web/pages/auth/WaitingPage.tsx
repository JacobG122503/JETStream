import { useState } from 'react'
import { errorMessage } from '../../api'
import { useAuth, usePerson } from '../../auth/authContext'
import { announce, Button, Notice, useToast } from '../../ui'
import { AuthPage } from './AuthPage'

/** For someone who signed in but was not approved yet. */
export function WaitingPage() {
  const { info, refresh, signOut } = useAuth()
  const person = usePerson()
  const toast = useToast()
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(0)

  const check = async () => {
    setChecking(true)
    await refresh()
    setChecking(false)
    setChecked((count) => count + 1)
    announce('Still waiting for approval')
  }

  return (
    <AuthPage title="Waiting for approval" description={`Signed in as ${person.name} (${person.email})`}>
      <Notice tone="info">
        An administrator at {info?.company.name} must approve your account before you can use JET Time.
        {checked > 0 && ' Not approved yet.'}
      </Notice>
      <div className="form-actions">
        <Button variant="primary" icon="refresh" loading={checking} loadingLabel="Checking" onClick={() => void check()}>
          Check again
        </Button>
        <Button icon="signOut" onClick={() => void signOut().catch((error: unknown) => toast.error(errorMessage(error)))}>
          Sign out
        </Button>
      </div>
    </AuthPage>
  )
}
