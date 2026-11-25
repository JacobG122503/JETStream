import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routerFuture } from '../routes'
import { AppShell, type AppShellProps } from './AppShell'
import { isCurrentItem, navItems } from './navigation'
import { Page } from './Page'
import { RouteEffects } from './RouteEffects'

const labels = ['Home', 'Timesheet', 'Expenses', 'Team', 'Clients', 'Projects', 'Tasks', 'Invoices', 'Approvals', 'Reports', 'Settings']

function Breaking() {
  const [broken, setBroken] = useState(false)
  if (broken) throw new Error('Sample error')
  return (
    <Page title="Breaking">
      <button onClick={() => setBroken(true)}>Break</button>
    </Page>
  )
}

function renderShell(path: string, props: AppShellProps = {}, basename?: string) {
  const router = createMemoryRouter(
    [
      {
        element: <RouteEffects />,
        children: [
          {
            element: <AppShell {...props} />,
            children: [
              { path: '/breaking', element: <Breaking /> },
              { path: '/projects/:id', element: <Page title="Project"> </Page> },
              {
                path: '*',
                element: (
                  <Page title="Any page">
                    <Link to="?x=1">Query</Link>
                    <Link to="#part">Fragment</Link>
                  </Page>
                ),
              },
            ],
          },
        ],
      },
    ],
    { initialEntries: [path], basename, future: routerFuture },
  )
  render(<RouterProvider router={router} future={{ v7_startTransition: true }} />)
  return router
}

const nav = () => screen.getByRole('navigation', { name: 'Main' })
const links = () => within(nav()).getAllByRole('link')
const currentLinks = () => links().filter((link) => link.getAttribute('aria-current') === 'page')

beforeEach(() => {
  document.title = ''
})

describe('navigation', () => {
  it('lists the sections in order with their addresses', () => {
    renderShell('/time')
    expect(links().map((link) => link.textContent)).toEqual(labels)
    expect(links().map((link) => link.getAttribute('href'))).toEqual(
      ['/home', '/time', '/expenses', '/team', '/clients', '/projects', '/tasks', '/invoices', '/approvals', '/reports', '/settings'],
    )
  })

  it('has the name of the product in the sidebar and the header, leading to Home', () => {
    renderShell('/reports')
    const brands = screen.getAllByText('JETStream').map((name) => name.closest('a'))
    expect(brands).toHaveLength(2)
    for (const brand of brands) {
      expect(brand).toHaveAttribute('href', '/home')
      expect(brand).toHaveTextContent('by JET Engineering')
    }
  })

  it('has the base path in addresses', () => {
    renderShell('/jetstream/time', {}, '/jetstream/')
    expect(links()[0]).toHaveAttribute('href', '/jetstream/home')
  })

  it.each([
    ['/time', 'Timesheet'],
    ['/time/', 'Timesheet'],
    ['/projects/123', 'Projects'],
    ['/Projects/123/tasks', 'Projects'],
  ])('at %s the current item is %s', (path, label) => {
    renderShell(path)
    expect(currentLinks().map((link) => link.textContent)).toEqual([label])
  })

  it.each(['/timeless', '/time-off', '/nope'])('at %s nothing is current', (path) => {
    renderShell(path)
    expect(currentLinks()).toHaveLength(0)
    expect(navItems.some((item) => isCurrentItem(item, path))).toBe(false)
  })

  it('can hide items; the order of the rest is unchanged', () => {
    renderShell('/time', { isNavItemVisible: (item) => item.id !== 'invoices' })
    expect(links().map((link) => link.textContent)).toEqual(labels.filter((label) => label !== 'Invoices'))
  })

  it('shows what is placed in the header', () => {
    renderShell('/time', { headerContent: <p>Running timer</p> })
    expect(within(screen.getByRole('banner')).getByText('Running timer')).toBeInTheDocument()
  })

  it('shows nothing else in the header without that', () => {
    renderShell('/time')
    const header = within(screen.getByRole('banner'))
    expect(header.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['Menu', 'Appearance: System'])
  })
})

describe('route changes', () => {
  it('move focus to the heading and scroll to the top, but not on the first page', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    renderShell('/time')
    expect(document.body).toHaveFocus()
    await userEvent.click(within(nav()).getByRole('link', { name: 'Reports' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('of only the query or fragment do neither', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const router = renderShell('/time')
    for (const name of ['Query', 'Fragment']) {
      await userEvent.click(screen.getByRole('link', { name }))
      expect(screen.getByRole('link', { name })).toHaveFocus()
    }
    expect(router.state.location).toMatchObject({ pathname: '/time', hash: '#part' })
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('set the document title', () => {
    renderShell('/breaking')
    expect(document.title).toBe('Breaking | JETStream')
  })
})

describe('skip link', () => {
  it('is first, and moves focus to the main area without changing the address', async () => {
    const router = renderShell('/reports?x=1')
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
    expect(router.state.location).toMatchObject({ pathname: '/reports', search: '?x=1', hash: '' })
  })
})

describe('drawer', () => {
  const menuButton = () => screen.getByRole('button', { name: 'Menu', hidden: true })
  const drawer = () => screen.queryByRole('dialog', { name: 'Main menu' })

  it('opens with focus inside, makes the page inert, and closes with Escape', async () => {
    renderShell('/time')
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(menuButton())
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true')
    expect(drawer()).toContainElement(document.activeElement as HTMLElement)
    expect(within(drawer() as HTMLElement).getAllByRole('link').slice(1).map((link) => link.textContent)).toEqual(labels)
    expect(screen.getByRole('main', { hidden: true }).closest('[inert]')).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(drawer()).not.toBeInTheDocument()
    expect(menuButton()).toHaveFocus()
  })

  it('closes with its button and on a press outside, and returns focus', async () => {
    renderShell('/time')
    await userEvent.click(menuButton())
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(drawer()).not.toBeInTheDocument()
    expect(menuButton()).toHaveFocus()
    await userEvent.click(menuButton())
    await userEvent.click(document.querySelector('.drawer-layer') as Element)
    expect(drawer()).not.toBeInTheDocument()
    expect(menuButton()).toHaveFocus()
  })

  it.each(['Invoices', 'Timesheet'])('closes when %s is chosen, and focus goes to the heading', async (name) => {
    renderShell('/time')
    await userEvent.click(menuButton())
    await userEvent.click(within(drawer() as HTMLElement).getByRole('link', { name }))
    expect(drawer()).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  })

  it('closes on Back, and focus goes to the heading', async () => {
    const router = renderShell('/time')
    await act(() => router.navigate('/team'))
    await userEvent.click(menuButton())
    await act(() => router.navigate(-1))
    await waitFor(() => expect(drawer()).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  })

  it('closes when the window grows', async () => {
    let grow: () => void = () => undefined
    let wide = false
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (media) =>
        ({
          media,
          get matches() {
            return wide && media.includes('min-width')
          },
          addEventListener: (_: string, listener: () => void) => {
            if (media.includes('min-width')) grow = listener
          },
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    )
    renderShell('/time')
    await userEvent.click(menuButton())
    wide = true
    act(() => grow())
    expect(drawer()).not.toBeInTheDocument()
    expect(document.documentElement.style.overflow).toBe('')
    expect(screen.getByRole('main').closest('[inert]')).toBeNull()
  })
})

describe('an error while a page renders', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('is shown inside the shell and can be tried again', async () => {
    renderShell('/breaking')
    await userEvent.click(screen.getByRole('button', { name: 'Break' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toHaveFocus()
    expect(document.title).toBe('Something went wrong | JETStream')
    expect(links()).toHaveLength(labels.length)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('button', { name: 'Break' })).toBeInTheDocument()
    expect(document.title).toBe('Breaking | JETStream')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Breaking' })).toHaveFocus())
  })

  it('is gone on another page', async () => {
    renderShell('/breaking')
    await userEvent.click(screen.getByRole('button', { name: 'Break' }))
    await userEvent.click(within(nav()).getByRole('link', { name: 'Clients' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Any page' })).toBeInTheDocument()
  })
})
