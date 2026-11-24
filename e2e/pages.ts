import type { Page } from '@playwright/test'
import { expect } from './fixtures'

/** Path (relative to the base path) and heading of every section, in the order of the navigation. */
export const sections = [
  ['time', 'Time'],
  ['expenses', 'Expenses'],
  ['projects', 'Projects'],
  ['clients', 'Clients'],
  ['team', 'Team'],
  ['schedule', 'Schedule'],
  ['time-off', 'Time off'],
  ['reports', 'Reports'],
  ['invoices', 'Invoices'],
  ['estimates', 'Estimates'],
  ['settings', 'Settings'],
] as const

export const allPages = [
  ...sections,
  ['nope', 'Page not found'],
  ['design', 'Design system'],
  ['design/plain', 'Layout without navigation'],
] as const

export const phone = { width: 375, height: 812 }
export const desktop = { width: 1440, height: 900 }

/** Opens a page and waits until it is there and nothing is being requested. */
export async function open(page: Page, path: string, heading?: string) {
  await page.goto(path)
  const title = page.getByRole('heading', { level: 1 })
  if (heading) await expect(title).toHaveText(heading)
  else await expect(title).toBeVisible()
  if (/^design\/?(?:[?#]|$)/.test(path)) await expect(page.getByText('Server connected')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

/** Leaves a mark that is gone after the document is loaded again. */
export async function markDocument(page: Page) {
  await page.evaluate(() => document.documentElement.setAttribute('data-mark', ''))
}

export async function expectSameDocument(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-mark')
}

export const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' })
export const pageTitle = (page: Page) => page.getByRole('heading', { level: 1 })
export const dialog = (page: Page, name?: string | RegExp) => page.getByRole('dialog', { name })

export async function expectNoSidewaysScroll(page: Page, what: string) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll, `${what}: width of the page`).toBeLessThanOrEqual(client)
}
