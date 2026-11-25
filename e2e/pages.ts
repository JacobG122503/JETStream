import type { Page } from '@playwright/test'
import { expect, settled } from './fixtures'

/** Path (relative to the base path) and heading of every section, in the order of the navigation. */
export const sections = [
  ['home', 'Home'],
  ['time', 'Timesheet'],
  ['expenses', 'Expenses'],
  ['team', 'Team'],
  ['clients', 'Clients'],
  ['projects', 'Projects'],
  ['tasks', 'Tasks'],
  ['invoices', 'Invoices'],
  ['approvals', 'Approvals'],
  ['notifications', 'Notifications'],
  ['settings/notifications', 'Notifications'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
] as const

/** Before signing in. */
export const signedOutPages = [
  ['sign-in', 'Sign in'],
  ['sign-up', 'Ask for an account'],
  ['forgot-password', 'Forgot password'],
  ['invite', 'This link no longer works'],
  ['reset-password', 'This link no longer works'],
] as const

export const allPages = [
  ...sections,
  ['time?view=week', 'Timesheet'],
  ['team?tab=people', 'Team'],
  ['projects/1', 'Turbine foundation design'],
  ['clients/1', 'Tallgrass Wind Cooperative'],
  ['invoices/new', 'New invoice'],
  ['invoices/1', 'Invoice INV-0001'],
  ['settings/roles', 'Roles'],
  ['settings/roles/new', 'New role'],
  ['account', 'Account'],
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
  await settled(page)
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
