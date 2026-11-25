import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { routerFuture, routes } from './routes'
import { ServerStatus } from './ServerStatus'
import { navItems } from './shell/navigation'
import { person, sessionInfo } from './test/session'

/** Signed in as an employee. */
async function renderAt(path: string, basename?: string) {
  const router = createMemoryRouter(routes, { basename, initialEntries: [path], future: routerFuture })
  const { unmount } = render(<App router={router} />)
  await screen.findByRole('heading', { level: 1 })
  return { router, unmount }
}

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  fetchMock.mockReset().mockImplementation((url) =>
    Promise.resolve(new Response(url === '/api/session' ? JSON.stringify(sessionInfo({ person })) : '{}')),
  )
  vi.stubGlobal('fetch', fetchMock)
  return () => vi.unstubAllGlobals()
})

describe('App', () => {
  it('leads from the root to Time without a history entry of its own', async () => {
    const { router } = await renderAt('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Time' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/time')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(document.body).toHaveFocus()
  })

  const notBuilt = navItems.filter(({ id }) => id !== 'team')
  it.each(notBuilt.map((item) => [item.path, item.label]))('%s is the page "%s", and says that it is not available', async (path, label) => {
    await renderAt(path)
    expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual([label])
    expect(document.title).toBe(`${label} | JETStream`)
    const main = within(screen.getByRole('main'))
    expect(main.getByRole('heading', { level: 2, name: 'Not available yet' })).toBeInTheDocument()
    expect(main.queryAllByRole('button')).toHaveLength(0)
    expect(main.queryAllByRole('link')).toHaveLength(0)
  })

  it.each(['/no-such-page', '/time/nope', '/no/such/page'])('shows "Page not found" inside the shell at %s', async (path) => {
    await renderAt(path)
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(document.title).toBe('Page not found | JETStream')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getAllByText('JETStream')[0]).toHaveClass('brand-name')
  })

  it('goes to Time from "Page not found"', async () => {
    const { router } = await renderAt('/no-such-page')
    await userEvent.click(screen.getByRole('link', { name: 'Go to Time' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Time' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/time')
  })

  it('keeps the base path in links', async () => {
    await renderAt('/jetstream/no/such/page', '/jetstream/')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found')
    expect(screen.getByRole('link', { name: 'Go to Time' })).toHaveAttribute('href', '/jetstream/time')
  })

  it('has a layout without navigation', async () => {
    await renderAt('/design/plain')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Layout without navigation')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByText('JETStream')).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByText('by JET Engineering')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Appearance/ })).toBeInTheDocument()
  })

  it('has a gallery that is not in the navigation and calls its data fictional', async () => {
    await renderAt('/design')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Design system')
    expect(screen.getByText(/the people, companies and figures are fictional/)).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', { name: /design/i })).not.toBeInTheDocument()
    expect(await screen.findByText('Server connected')).toBeInTheDocument()
  })
})

describe('server status', () => {
  it('is announced, first while checking and then when connected', async () => {
    let answer: (response: Response) => void = () => undefined
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    render(<ServerStatus />)
    expect(screen.getByRole('status')).toHaveTextContent('Checking server...')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    answer(new Response('{}'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Server connected'))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/health')
  })

  it.each([200, 503])('finishes the request when the answer is %i, and never cancels it', async (status) => {
    const response = new Response('{}', { status })
    fetchMock.mockResolvedValueOnce(response)
    const { unmount } = render(<ServerStatus />)
    await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent('Checking'))
    expect(response.bodyUsed).toBe(true)
    unmount()
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
  })

  it('lets a request finish after the page is left', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => undefined))
    render(<ServerStatus />).unmount()
    await Promise.resolve()
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
  })

  it.each([
    ['the request fails', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['the server answers 503', () => Promise.resolve(new Response('{}', { status: 503 }))],
  ])('offers another try when %s', async (_name, failure) => {
    fetchMock.mockImplementationOnce(failure)
    render(<ServerStatus />)
    expect(await screen.findByText('Cannot reach the server')).toHaveAttribute('role', 'status')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Server connected')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps focus on the button during a retry and ignores further presses', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<ServerStatus />)
    const button = await screen.findByRole('button', { name: 'Try again' })
    fetchMock.mockReturnValueOnce(new Promise(() => undefined))
    await userEvent.click(button)
    expect(screen.getByRole('status')).toHaveTextContent('Checking server...')
    expect(button).toHaveFocus()
    await userEvent.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
