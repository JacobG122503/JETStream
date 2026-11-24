import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { routerFuture, routes } from './routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture })
  const { unmount } = render(<App router={router} />)
  return { router, unmount }
}

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(() => Promise.resolve(new Response('{}')))
  vi.stubGlobal('fetch', fetchMock)
  return () => vi.unstubAllGlobals()
})

describe('App', () => {
  it('shows one level-1 heading "JET Time" on the home page', async () => {
    renderAt('/')
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent(/^JET Time$/)
    expect(await screen.findByText('Server connected')).toBeInTheDocument()
  })

  it.each(['/no-such-page', '/no/such/page'])('shows "Page not found" at %s', (path) => {
    renderAt(path)
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'JET Time' })).not.toBeInTheDocument()
  })

  it('returns to the home page from "Page not found"', async () => {
    const { router } = renderAt('/no-such-page')
    await userEvent.click(screen.getByRole('link', { name: 'Go to the home page' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'JET Time' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('keeps the base path in links', () => {
    const router = createMemoryRouter(routes, {
      basename: '/jettime/',
      initialEntries: ['/jettime/no/such/page'],
      future: routerFuture,
    })
    render(<App router={router} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/jettime/')
  })
})

describe('server status', () => {
  it('is announced, first while checking and then when connected', async () => {
    let answer: (response: Response) => void = () => undefined
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    renderAt('/')
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
    const { unmount } = renderAt('/')
    await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent('Checking'))
    expect(response.bodyUsed).toBe(true)
    unmount()
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
  })

  it('lets a request finish after the page is left', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => undefined))
    renderAt('/').unmount()
    await Promise.resolve()
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
  })

  it.each([
    ['the request fails', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['the server answers 503', () => Promise.resolve(new Response('{}', { status: 503 }))],
  ])('offers another try when %s', async (_name, failure) => {
    fetchMock.mockImplementationOnce(failure)
    renderAt('/')
    expect(await screen.findByText('Cannot reach the server')).toHaveAttribute('role', 'status')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Server connected')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps focus on the button during a retry and ignores further presses', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderAt('/')
    const button = await screen.findByRole('button', { name: 'Try again' })
    fetchMock.mockReturnValueOnce(new Promise(() => undefined))
    await userEvent.click(button)
    expect(screen.getByRole('status')).toHaveTextContent('Checking server...')
    expect(button).toHaveFocus()
    await userEvent.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
