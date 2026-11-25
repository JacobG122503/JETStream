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
  ['estimates', 'Estimates'],
  ['invoices', 'Invoices'],
  ['approvals', 'Approvals'],
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
  ['invoices/free?client=1', 'New invoice'],
  ['invoices/recurring', 'Recurring invoices'],
  ['invoices/recurring/1', 'Edit recurring invoice'],
  ['invoices/retainers', 'Retainers'],
  ['invoices/retainers/1', 'Turbine retainer'],
  ['clients/1/statement', 'Statement'],
  ['estimates/1', 'Estimate EST-0001'],
  ['estimates/new?client=1', 'New estimate'],
  ['approvals?status=submitted&from=2026-11-14', 'Approvals'],
  ['reports?tab=byPerson', 'Reports'],
  ['reports/detailed', 'Detailed time report'],
  ['reports/expenses?from=2026-07-18&to=2026-07-24', 'Detailed expense report'],
  ['reports/profitability', 'Profitability'],
  ['reports/contractors', 'Contractor report'],
  ['reports/activity', 'Activity log'],
  ['reports/saved', 'Saved reports'],
  ['team/3', 'Casey\u2019s basic info'],
  ['team/3/rates', 'Casey\u2019s rates'],
  ['team/3/projects', 'Casey\u2019s assigned projects'],
  ['team/3/people', 'Casey\u2019s assigned people'],
  ['team/6/permissions', 'Elena\u2019s permissions'],
  ['team/3/security', 'Casey\u2019s security'],
  ['reports/budgets', 'Project budgets'],
  ['reports/uninvoiced', 'Uninvoiced'],
  ['reports/invoices', 'Invoices report'],
  ['reports/payments', 'Payments'],
  ['settings/outbox', 'Outbox'],
  ['settings/export', 'Export'],
  ['notifications', 'Notifications'],
  ['settings/notifications', 'Notifications'],
  ['settings/categories', 'Expense categories'],
  ['settings/company', 'Company settings'],
  ['settings/activity', 'Activity log'],
  ['time?view=month', 'Timesheet'],
  ['settings/roles', 'Roles'],
  ['settings/roles/new', 'New role'],
  ['account', 'Account'],
  ['nope', 'Page not found'],
  ['design', 'Design system'],
  ['design/plain', 'Layout without navigation'],
] as const

export const phone = { width: 375, height: 812 }
export const desktop = { width: 1440, height: 900 }

/** Those of detailed reports go on with the dates. */
export async function expectHeading(page: Page, heading: string) {
  if (heading.startsWith('Detailed')) await expect(pageTitle(page)).toContainText(`${heading}: `)
  else await expect(pageTitle(page)).toHaveText(heading)
}

/** Opens a page and waits until it is there and nothing is being requested. */
export async function open(page: Page, path: string, heading?: string) {
  // What the page before still asks for would be cut off.
  await settled(page)
  await page.goto(path)
  const title = page.getByRole('heading', { level: 1 })
  if (heading) await expectHeading(page, heading)
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
