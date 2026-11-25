import { type FormEvent, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import type { SessionInfo } from '../../../shared/api'
import { productName } from '../../../shared/product'
import { callApi } from '../../api'
import { useAuth } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { homePath, safeReturnPath } from '../../auth/returnPath'
import { useForm } from '../../auth/useForm'
import { Button, Card, Checkbox, Notice, PasswordField, TextField } from '../../ui'
import { AuthPage } from './AuthPage'

const fields = ['email', 'password'] as const

/** What other pages say when they lead here. */
interface Hints {
  /** The session of this person ended. */
  endedFor: number | null
  passwordSet: boolean
}

function readHints(state: unknown): Hints {
  const source = state instanceof Object ? state : {}
  return {
    endedFor: 'endedFor' in source && typeof source.endedFor === 'number' ? source.endedFor : null,
    passwordSet: 'passwordSet' in source && source.passwordSet === true,
  }
}

export function SignInPage() {
  const { info, accept } = useAuth()
  const { state } = useLocation() as { state: unknown }
  const [query] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(false)
  /** Set by signing in on this page, as opposed to coming here signed in. */
  const [signedInHere, setSignedInHere] = useState(false)
  const form = useForm('sign-in', fields)
  const { endedFor, passwordSet } = readHints(state)

  if (info?.person) {
    // Back to the page that was asked for, unless it was someone else's.
    const back = signedInHere && (endedFor === null || endedFor === info.person.id)
    return <Navigate to={back ? safeReturnPath(query.get('next')) : homePath} replace />
  }

  const signIn = async (route: string, body: object) => {
    const answer = await callApi<SessionInfo>('POST', route, body)
    setSignedInHere(true)
    accept(answer)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(() => signIn('session/sign-in', { email, password, keep }), {
      email: email.trim() === '' ? 'Enter your email address.' : null,
      password: password === '' ? 'Enter your password.' : null,
    })
  }
  const demoAccounts = info?.demoAccounts ?? []

  return (
    <AuthPage title="Sign in" description={info ? `${productName} at ${info.company.name}` : undefined}>
      {endedFor !== null && (
        <Notice tone="warning" announce="status">
          Your session has ended. Sign in again to go on.
        </Notice>
      )}
      {passwordSet && (
        <Notice tone="success" announce="status">
          Your new password is set. Sign in with it.
        </Notice>
      )}
      {demoAccounts.length > 0 && (
        <Notice title="This is a demo">
          <p>All people, companies and figures are made up. Choose whose view to see:</p>
          <div className="demo-accounts">
            {demoAccounts.map(({ key, label, name }) => (
              <Button
                key={key}
                variant="secondary"
                aria-disabled={form.busy || undefined}
                onClick={() => void form.submit(() => signIn('session/demo', { account: key }))}
              >
                <span className="demo-account">
                  <span className="demo-account-label">{label}</span>
                  <span>{name}</span>
                </span>
              </Button>
            ))}
          </div>
        </Notice>
      )}
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
          <PasswordField
            label="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
            {...form.field('password')}
          />
          <Checkbox label="Keep me signed in" hint="Not on a computer that others use." checked={keep} onChange={setKeep} />
          <div className="form-wide">
            <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Signing in">
              Sign in
            </Button>
          </div>
        </form>
      </Card>
      <nav className="auth-links" aria-label="Help with signing in">
        <Link to="/forgot-password">Forgot password?</Link>
        {info?.signUpOpen && <Link to="/sign-up">Ask for an account</Link>}
      </nav>
    </AuthPage>
  )
}
