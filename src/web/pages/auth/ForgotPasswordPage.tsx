import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { callApi } from '../../api'
import { useAuth } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { Button, Card, LinkButton, Notice, TextField } from '../../ui'
import { AuthPage } from './AuthPage'

const fields = ['email'] as const

export function ForgotPasswordPage() {
  const { info } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const form = useForm('forgot-password', fields)
  const delivers = info?.emailDelivers ?? false

  if (sent) {
    return (
      <AuthPage title="Request received">
        <Notice tone="success" announce="status">
          {delivers
            ? 'If there is an account with this address, an email with a link to set a new password was sent to it.'
            : 'If there is an account with this address, an administrator now sees that you need help, and will provide a link to set a new password. No email is sent.'}
        </Notice>
        <div className="form-actions">
          <LinkButton to="/sign-in" variant="primary">
            Go to sign in
          </LinkButton>
        </div>
      </AuthPage>
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        await callApi('POST', 'forgot-password', { email })
        setSent(true)
      },
      { email: email.trim() === '' ? 'Enter your email address.' : null },
    )
  }

  return (
    <AuthPage
      title="Forgot password"
      description={
        delivers ? 'You get an email with a link to set a new password.' : 'An administrator will provide a link to set a new password.'
      }
    >
      <Card>
        <form className="stack" noValidate onSubmit={submit}>
          <FormMessages form={form} />
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
          <div className="form-wide">
            <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Sending">
              Ask for help
            </Button>
          </div>
        </form>
      </Card>
      <nav className="auth-links" aria-label="Other ways in">
        <Link to="/sign-in">Back to sign in</Link>
      </nav>
    </AuthPage>
  )
}
