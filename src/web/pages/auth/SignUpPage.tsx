import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { callApi } from '../../api'
import { useAuth } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { NewPasswordField } from '../../auth/NewPassword'
import { TimeZoneField } from '../../auth/TimeZoneField'
import { useForm } from '../../auth/useForm'
import { Button, Card, LinkButton, Notice, TextField } from '../../ui'
import { AuthPage } from './AuthPage'

const fields = ['name', 'email', 'password', 'timeZone'] as const

export function SignUpPage() {
  const { info } = useAuth()
  const company = info?.company ?? { name: '', timeZone: 'America/Chicago' }
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [timeZone, setTimeZone] = useState<string | null>(company.timeZone)
  const [sent, setSent] = useState(false)
  const form = useForm('sign-up', fields)

  if (sent) {
    return (
      <AuthPage title="Request received">
        <Notice tone="success" announce="status">
          An administrator at {company.name} must approve your account. Until then you can sign in, but see nothing else.
        </Notice>
        <div className="form-actions">
          <LinkButton to="/sign-in" variant="primary">
            Go to sign in
          </LinkButton>
        </div>
      </AuthPage>
    )
  }
  if (!info?.signUpOpen) {
    return (
      <AuthPage title="Ask for an account">
        <Notice tone="info">
          Requests to join are turned off at the moment. Ask an administrator at {company.name} for an invite.
        </Notice>
        <div className="form-actions">
          <LinkButton to="/sign-in">Go to sign in</LinkButton>
        </div>
      </AuthPage>
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        await callApi('POST', 'sign-up', { name, email, password, timeZone })
        setPassword('')
        setSent(true)
      },
      {
        name: name.trim() === '' ? 'Enter your name.' : null,
        email: email.trim() === '' ? 'Enter your email address.' : null,
        password: password === '' ? 'Choose a password.' : null,
        timeZone: timeZone === null ? 'Choose a time zone from the list.' : null,
      },
    )
  }

  return (
    <AuthPage title="Ask for an account" description={`You ask to join ${company.name}. An administrator decides.`}>
      <Card>
        <form className="stack" noValidate onSubmit={submit}>
          <FormMessages form={form} />
          <TextField label="Name" autoComplete="name" required value={name} onChange={setName} {...form.field('name')} />
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={setEmail}
            {...form.field('email')}
          />
          <NewPasswordField label="Password" value={password} onChange={setPassword} {...form.field('password')} />
          <TimeZoneField companyTimeZone={company.timeZone} value={timeZone} onChange={setTimeZone} {...form.field('timeZone')} />
          <div className="form-wide">
            <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Sending">
              Send request
            </Button>
          </div>
        </form>
      </Card>
      <nav className="auth-links" aria-label="Other ways in">
        <Link to="/sign-in">I have an account</Link>
      </nav>
    </AuthPage>
  )
}
