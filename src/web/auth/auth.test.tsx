import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { routerFuture, routes } from '../routes'
import { failure, fakeServer } from '../test/fakeServer'
import { administrator, person, sessionInfo } from '../test/session'

const server = fakeServer()
const signedIn = sessionInfo({ person })

async function open(path: string, heading?: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture })
  render(<App router={router} />)
  await screen.findByRole('heading', heading ? { level: 1, name: heading } : { level: 1 })
  return router
}
const heading = (name: string) => screen.findByRole('heading', { level: 1, name })
const where = (router: Awaited<ReturnType<typeof open>>) => router.state.location.pathname + router.state.location.search
const refocus = () => act(() => void window.dispatchEvent(new Event('focus')))

async function fillSignIn(password = 'a good password') {
  await userEvent.type(screen.getByLabelText(/^Email/), 'casey@jet.example')
  await userEvent.type(screen.getByLabelText(/^Password/), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('signed out', () => {
  it.each(['/time', '/team/3', '/account', '/nope', '/reports?x=1'])('%s leads to sign-in and shows no section before', async (path) => {
    const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture })
    render(<App router={router} />)
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    await heading('Sign in')
    expect(where(router)).toBe(`/sign-in?next=${encodeURIComponent(path)}`)
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it.each([['/design', 'Design system'], ['/design/plain', 'Layout without navigation']])('%s can be seen', async (path, title) => {
    await open(path, title)
    expect(screen.queryByRole('button', { name: /^Account/ })).not.toBeInTheDocument()
  })

  it('after signing in the page that was asked for is shown, with its query', async () => {
    const router = await open('/reports?x=1', 'Sign in')
    server.handlers['POST session/sign-in'] = () => server.signIn(signedIn)
    await fillSignIn()
    await heading('Reports')
    expect(where(router)).toBe('/reports?x=1')
    expect(server.sent('POST session/sign-in')[0]?.body).toEqual({ email: 'casey@jet.example', password: 'a good password', keep: false })
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  })

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/\u0001'])('is not led to %j', async (next) => {
    const router = await open(`/sign-in?next=${encodeURIComponent(next)}`, 'Sign in')
    server.handlers['POST session/sign-in'] = () => server.signIn(signedIn)
    await fillSignIn()
    await heading('Home')
    expect(where(router)).toBe('/home')
  })

  it('tells what is missing, then what is wrong, and when to try again', async () => {
    await open('/sign-in', 'Sign in')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const summary = screen.getByRole('group', { name: 'There are 2 problems' })
    expect(summary).toHaveFocus()
    await userEvent.click(within(summary).getByRole('link', { name: 'Enter your password.' }))
    expect(screen.getByLabelText(/^Password/)).toHaveFocus()
    server.handlers['POST session/sign-in'] = () => failure(401, 'invalid_credentials', { message: 'The email or password is not right.' })
    await fillSignIn()
    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password is not right.')
    server.handlers['POST session/sign-in'] = () => failure(429, 'too_many_attempts', { retryAfterSeconds: 840 })
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Try again in 14 minutes, at \d+:\d\d/))
    expect(screen.getByLabelText(/^Email/)).toHaveValue('casey@jet.example')
  })

  it('signs in once when pressed twice quickly', async () => {
    await open('/sign-in', 'Sign in')
    let answer: (value: object) => void = () => undefined
    server.handlers['POST session/sign-in'] = () => new Promise((resolve) => (answer = resolve))
    await fillSignIn()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await userEvent.keyboard('{Enter}')
    expect(server.sent('POST session/sign-in')).toHaveLength(1)
    answer(server.signIn(signedIn))
    await heading('Home')
  })

  it('shows the password on request, and keeps nothing in browser storage', async () => {
    await open('/sign-in', 'Sign in')
    const field = screen.getByLabelText(/^Password/)
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'current-password')
    const toggle = screen.getByRole('button', { name: 'Show password' })
    await userEvent.click(toggle)
    expect(field).toHaveAttribute('type', 'text')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.type(field, 'secret words')
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie).not.toContain('secret')
  })

  it('offers sign-up and demo accounts only where the server does', async () => {
    server.session = sessionInfo({ signUpOpen: false })
    await open('/sign-in', 'Sign in')
    expect(screen.queryByRole('link', { name: 'Ask for an account' })).not.toBeInTheDocument()
    expect(screen.queryByText('This is a demo')).not.toBeInTheDocument()
  })

  it('signs in as a demo account with one press', async () => {
    server.session = sessionInfo({ demoAccounts: [{ key: 'admin', label: 'Administrator', name: 'Avery Example' }] })
    await open('/sign-in', 'Sign in')
    server.handlers['POST session/demo'] = () => server.signIn(sessionInfo({ person: administrator }))
    await userEvent.click(screen.getByRole('button', { name: /Administrator.*Avery Example/ }))
    await heading('Home')
    expect(server.sent('POST session/demo')[0]?.body).toEqual({ account: 'admin' })
    expect(screen.getByRole('button', { name: 'Account: Avery Example , Administrator' })).toBeInTheDocument()
  })

  it('says so when the server cannot be reached, and tries again', async () => {
    let down = true
    server.handlers['GET session'] = () => {
      if (down) throw new TypeError('Failed to fetch')
      return server.session
    }
    await open('/time', 'Cannot reach the server')
    down = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await heading('Sign in')
  })
})

describe('signed in', () => {
  it.each(['/sign-in', '/sign-in?next=%2Freports', '/sign-up', '/forgot-password'])('%s leads to the home page', async (path) => {
    server.session = signedIn
    const router = await open(path, 'Home')
    expect(where(router)).toBe('/home')
  })

  it('the account menu names the person, opens the account and signs out, after which Back shows nothing', async () => {
    server.session = signedIn
    const router = await open('/reports', 'Reports')
    const button = screen.getByRole('button', { name: /^Account: Casey Example ?, Member$/ })
    await userEvent.click(button)
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Account', 'Sign out'])
    server.handlers['POST session/sign-out'] = () => server.signIn(sessionInfo())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    await heading('Sign in')
    expect(where(router)).toBe('/sign-in')
    expect(screen.queryByText(/session has ended/)).not.toBeInTheDocument()
    expect(server.sent('POST session/sign-out')[0]?.csrfToken).toBe('token of 7')
    await act(() => router.navigate('/reports'))
    await heading('Sign in')
  })

  it('a session that ends leads to sign-in, says so, and back to the page for the same person', async () => {
    server.session = signedIn
    server.handlers['GET account'] = () => {
      server.session = sessionInfo()
      return failure(401, 'unauthenticated')
    }
    const router = await open('/account?x=1')
    await heading('Sign in')
    expect(screen.getByText('Your session has ended. Sign in again to go on.')).toBeInTheDocument()
    delete server.handlers['GET account']
    server.handlers['POST session/sign-in'] = () => server.signIn(signedIn)
    await fillSignIn()
    await heading('Account')
    expect(where(router)).toBe('/account?x=1')
  })

  it('and to the home page for someone else', async () => {
    server.session = signedIn
    const router = await open('/reports', 'Reports')
    server.session = sessionInfo()
    refocus()
    await heading('Sign in')
    server.handlers['POST session/sign-in'] = () => server.signIn(sessionInfo({ person: administrator }))
    await fillSignIn()
    await heading('Home')
    expect(where(router)).toBe('/home')
  })

  it('a change is refused after someone else signed in in another tab, and the page becomes theirs', async () => {
    server.session = signedIn
    await open('/time', 'Time')
    server.session = sessionInfo({ person: administrator })
    server.handlers['POST session/sign-out'] = ({ csrfToken }) =>
      csrfToken === 'token of 1' ? server.signIn(sessionInfo()) : failure(403, 'csrf')
    await userEvent.click(screen.getByRole('button', { name: /^Account: Casey/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByText('Someone else signed in on this browser. You are now working as Avery Example.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Account: Avery/ })).toBeInTheDocument()
    expect(server.sent('POST session/sign-out')).toHaveLength(1)
  })

  it('a change is sent again with a new token when the same person signed in again in another tab', async () => {
    server.session = signedIn
    await open('/time', 'Time')
    server.session = { ...signedIn, csrfToken: 'new token' }
    server.handlers['POST session/sign-out'] = ({ csrfToken }) => (csrfToken === 'new token' ? server.signIn(sessionInfo()) : failure(403, 'csrf'))
    await userEvent.click(screen.getByRole('button', { name: /^Account: Casey/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    await heading('Sign in')
    expect(server.sent('POST session/sign-out').map(({ csrfToken }) => csrfToken)).toEqual(['token of 7', 'new token'])
  })

  it('keeps what is shown when the server cannot be asked on coming back', async () => {
    server.session = signedIn
    await open('/time', 'Time')
    server.handlers['GET session'] = () => {
      throw new TypeError('Failed to fetch')
    }
    refocus()
    await waitFor(() => expect(server.sent('GET session').length).toBeGreaterThan(1))
    await heading('Time')
  })
})

it('waits for approval with "Check again" and "Sign out" only', async () => {
  server.session = sessionInfo({ person: { ...person, status: 'pending' } })
  const router = await open('/reports', 'Waiting for approval')
  expect(within(screen.getByRole('main')).getAllByRole('button').map((button) => button.textContent)).toEqual(['Check again', 'Sign out'])
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
  expect(await screen.findByText(/Not approved yet/)).toBeInTheDocument()
  server.session = signedIn
  await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
  await heading('Reports')
  expect(where(router)).toBe('/reports')
})

describe('links', () => {
  const token = 'T'.repeat(43)
  const invite = { company: 'JET Engineering', companyTimeZone: 'America/Chicago', name: 'Ivy', email: 'ivy@client.example', role: 'Manager' }

  it('take the token out of the address at once and send it in the body only', async () => {
    let answer: (value: object) => void = () => undefined
    server.handlers['GET session'] = () => new Promise((resolve) => (answer = resolve))
    const router = createMemoryRouter(routes, { initialEntries: [`/invite#${token}`], future: routerFuture })
    render(<App router={router} />)
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    expect(server.sent('POST invite/check')).toEqual([])
    server.handlers['POST invite/check'] = () => invite
    answer(server.session)
    await heading('Accept your invite')
    expect(await screen.findByText('Manager')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('readonly')
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Ivy')
    expect(server.calls.map(({ route }) => route).join()).not.toContain(token)
    expect(server.sent('POST invite/check')[0]?.body).toEqual({ token })

    server.handlers['POST invite/accept'] = () => server.signIn(signedIn)
    await userEvent.type(screen.getByLabelText(/^Password/), 'a good password')
    await userEvent.click(screen.getByRole('button', { name: 'Accept and sign in' }))
    await heading('Home')
    expect(server.sent('POST invite/accept')[0]?.body).toEqual({ token, name: 'Ivy', password: 'a good password', timeZone: 'America/Chicago' })
  })

  it.each([['/invite', 'invite/check'], ['/reset-password', 'reset-password/check']])('%s shows one page for a link that does not work', async (path, route) => {
    server.handlers[`POST ${route}`] = () => failure(410, 'link_invalid')
    await open(`${path}#${token}`, 'This link no longer works')
    expect(screen.getByText(/Ask an administrator at JET Engineering/)).toBeInTheDocument()
  })

  it('ask whoever is signed in to sign out first', async () => {
    server.session = signedIn
    server.handlers['POST invite/check'] = () => invite
    server.handlers['POST session/sign-out'] = () => server.signIn(sessionInfo())
    await open(`/invite#${token}`, 'Accept your invite')
    expect(screen.getByText('You are signed in as Casey Example')).toBeInTheDocument()
    expect(server.sent('POST invite/check')).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Sign out and go on' }))
    expect(await screen.findByLabelText(/^Name/)).toHaveValue('Ivy')
  })

  it('set a new password and lead to sign-in', async () => {
    server.handlers['POST reset-password/check'] = () => ({ email: 'casey@jet.example' })
    server.handlers['POST reset-password/use'] = () => ({ status: 'done' })
    await open(`/reset-password#${token}`, 'Set a new password')
    await userEvent.type(await screen.findByLabelText(/^New password/), 'a good password')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
    await heading('Sign in')
    expect(screen.getByText('Your new password is set. Sign in with it.')).toBeInTheDocument()
  })
})

describe('asking', () => {
  it('for an account: shows the rule, marks what the server refuses, and says what happens next', async () => {
    server.handlers['POST sign-up'] = () => failure(400, 'invalid_input', { fields: { password: 'This password is too common.' } })
    await open('/sign-up', 'Ask for an account')
    expect(screen.getByLabelText(/^Password/)).toHaveAccessibleDescription(/10 to 128 characters/)
    await userEvent.type(screen.getByLabelText(/^Name/), 'Ivy')
    await userEvent.type(screen.getByLabelText(/^Email/), 'ivy@client.example')
    await userEvent.type(screen.getByLabelText(/^Password/), 'password123')
    expect(screen.getByRole('combobox', { name: /^Time zone/ })).toHaveValue('America/Chicago')
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByRole('link', { name: 'This password is too common.' })).toBeInTheDocument()
    server.handlers['POST sign-up'] = () => ({ status: 'received' })
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
    await heading('Request received')
    expect(screen.getByText(/An administrator at JET Engineering must approve/)).toBeInTheDocument()
  })

  it('for an account is not possible while it is off', async () => {
    server.session = sessionInfo({ signUpOpen: false })
    await open('/sign-up', 'Ask for an account')
    expect(screen.getByText(/turned off at the moment/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument()
  })

  it.each([
    [false, /an administrator now sees that you need help.*No email is sent/],
    [true, /an email with a link to set a new password was sent/],
  ])('for help says truthfully what happens (email works: %s)', async (emailDelivers, text) => {
    server.session = sessionInfo({ emailDelivers })
    server.handlers['POST forgot-password'] = () => ({ status: 'received' })
    await open('/forgot-password', 'Forgot password')
    await userEvent.type(screen.getByLabelText(/^Email/), 'ivy@client.example')
    await userEvent.click(screen.getByRole('button', { name: 'Ask for help' }))
    expect(await screen.findByText(text)).toBeInTheDocument()
  })
})

it('does not let an answer from before signing in sign out again', async () => {
  await open('/sign-in', 'Sign in')
  let late: (value: object) => void = () => undefined
  server.handlers['GET session'] = () => new Promise((resolve) => (late = resolve))
  refocus()
  server.handlers['POST session/sign-in'] = () => signedIn
  await fillSignIn()
  await heading('Home')
  act(() => late(sessionInfo()))
  await vi.waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Home'))
})
