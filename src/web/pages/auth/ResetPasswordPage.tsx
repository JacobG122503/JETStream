import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, callApi } from '../../api'
import { useAuth } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { NewPasswordField } from '../../auth/NewPassword'
import { KnownSession } from '../../auth/guards'
import { useForm } from '../../auth/useForm'
import { Button, Card, TextField } from '../../ui'
import { AuthPage } from './AuthPage'
import { LinkState, SignOutFirst } from './LinkPage'
import { useLinkCheck } from './useLinkCheck'
import { useLinkToken } from './useLinkToken'

const title = 'Set a new password'
const fields = ['password'] as const

export function ResetPasswordPage() {
  // Before anything else, so that the address bar is clean at once.
  const token = useLinkToken()
  return (
    <KnownSession>
      <ResetPassword key={token} token={token} />
    </KnownSession>
  )
}

function ResetPassword({ token }: { token: string }) {
  const { info } = useAuth()
  const navigate = useNavigate()
  const signedIn = info?.person != null
  const { data, error, retry, fail } = useLinkCheck<{ email: string }>('reset-password/check', token, !signedIn)
  const [password, setPassword] = useState('')
  const form = useForm('reset-password', fields)

  if (signedIn) return <SignOutFirst title={title} what="Sign out to set a new password with this link." />
  if (!data) return <LinkState title={title} error={error} onRetry={retry} />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        try {
          await callApi('POST', 'reset-password/use', { token, password })
          navigate('/sign-in', { replace: true, state: { passwordSet: true } })
        } catch (reason) {
          if (reason instanceof ApiError && reason.code === 'link_invalid') fail(reason)
          throw reason
        }
      },
      { password: password === '' ? 'Choose a password.' : null },
    )
  }

  return (
    <AuthPage title={title} description="Afterwards you sign in with it. All devices that are signed in now are signed out.">
      <Card>
        <form className="stack" noValidate onSubmit={submit}>
          <FormMessages form={form} />
          <TextField label="Email" type="email" autoComplete="username" readOnly value={data.email} onChange={() => undefined} />
          <NewPasswordField label="New password" value={password} onChange={setPassword} {...form.field('password')} />
          <div className="form-wide">
            <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving">
              Set password
            </Button>
          </div>
        </form>
      </Card>
    </AuthPage>
  )
}
