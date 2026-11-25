import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { InviteInfo, SessionInfo } from '../../../shared/api'
import { productName } from '../../../shared/product'
import { ApiError, callApi } from '../../api'
import { useAuth } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { NewPasswordField } from '../../auth/NewPassword'
import { TimeZoneField } from '../../auth/TimeZoneField'
import { KnownSession } from '../../auth/guards'
import { useForm } from '../../auth/useForm'
import { Button, Card, TextField } from '../../ui'
import { AuthPage } from './AuthPage'
import { LinkState, SignOutFirst } from './LinkPage'
import { useLinkCheck } from './useLinkCheck'
import { useLinkToken } from './useLinkToken'

const title = 'Accept your invite'

export function InvitePage() {
  // Before anything else, so that the address bar is clean at once.
  const token = useLinkToken()
  return (
    <KnownSession>
      <Invite token={token} />
    </KnownSession>
  )
}

function Invite({ token }: { token: string }) {
  const { info } = useAuth()
  const [accepted, setAccepted] = useState(false)
  const signedIn = info?.person != null && !accepted
  const { data, error, retry, fail } = useLinkCheck<InviteInfo>('invite/check', token, !signedIn && !accepted)

  if (signedIn) return <SignOutFirst title={title} what="An invite is for someone else, or for a new account. Sign out to use it." />
  if (!data) return <LinkState title={title} error={error} onRetry={retry} />
  return <InviteForm key={token} invite={data} token={token} onAccepting={setAccepted} onDead={fail} />
}

const fields = ['name', 'password', 'timeZone'] as const

interface InviteFormProps {
  invite: InviteInfo
  token: string
  onAccepting: (accepting: boolean) => void
  onDead: (error: unknown) => void
}

function InviteForm({ invite, token, onAccepting, onDead }: InviteFormProps) {
  const { accept } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState(invite.name)
  const [password, setPassword] = useState('')
  const [timeZone, setTimeZone] = useState<string | null>(invite.companyTimeZone)
  const form = useForm('invite', fields)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        try {
          const answer = await callApi<SessionInfo>('POST', 'invite/accept', { token, name, password, timeZone })
          onAccepting(true)
          accept(answer)
          navigate('/', { replace: true })
        } catch (error) {
          if (error instanceof ApiError && error.code === 'link_invalid') onDead(error)
          throw error
        }
      },
      {
        name: name.trim() === '' ? 'Enter your name.' : null,
        password: password === '' ? 'Choose a password.' : null,
        timeZone: timeZone === null ? 'Choose a time zone from the list.' : null,
      },
    )
  }

  return (
    <AuthPage title={title} description={`${invite.company} invites you to ${productName}.`}>
      <Card>
        <form className="stack" noValidate onSubmit={submit}>
          <FormMessages form={form} />
          <dl className="facts">
            <dt>Company</dt>
            <dd>{invite.company}</dd>
            <dt>Role</dt>
            <dd>{invite.role}</dd>
          </dl>
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            readOnly
            hint="The invite is for this address."
            value={invite.email}
            onChange={() => undefined}
          />
          <TextField label="Name" autoComplete="name" required value={name} onChange={setName} {...form.field('name')} />
          <NewPasswordField label="Password" value={password} onChange={setPassword} {...form.field('password')} />
          <TimeZoneField companyTimeZone={invite.companyTimeZone} value={timeZone} onChange={setTimeZone} {...form.field('timeZone')} />
          <div className="form-wide">
            <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Accepting">
              Accept and sign in
            </Button>
          </div>
        </form>
      </Card>
    </AuthPage>
  )
}
