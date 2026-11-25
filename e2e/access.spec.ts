import { expect, test } from './fixtures'
import { api } from './people'
import { mainNav, open, sections } from './pages'

// What each demo account may open (005). Once is enough.
test.skip(({ basePath }) => basePath !== '/', 'once is enough')

const everyone = ['Home', 'Time', 'Expenses', 'Projects', 'Reports']
const noAccess = 'You do not have access to this page'

test('the navigation shows what each account may open', async ({ adminPage, leadPage, employeePage }) => {
  const shown = async (page: typeof adminPage) => {
    await open(page, 'time', 'Time')
    return mainNav(page).getByRole('link').allTextContents()
  }
  expect(await shown(adminPage)).toEqual(sections.map(([, label]) => label))
  expect(await shown(leadPage)).toEqual(['Home', 'Time', 'Expenses', 'Projects', 'Clients', 'Team', 'Reports'])
  expect(await shown(employeePage)).toEqual(everyone)
})

test('a page without permission says so and asks for nothing, and the API refuses', async ({ employeePage, leadPage }) => {
  for (const [page, paths] of [[employeePage, ['team', 'clients', 'invoices', 'invoices/1', 'settings', 'settings/roles']], [leadPage, ['invoices', 'settings/roles']]] as const) {
    for (const path of paths) {
      await open(page, path)
      await expect(page.getByRole('heading', { level: 2, name: noAccess }), path).toBeVisible()
    }
    expect((await page.request.get('/api/roles')).status()).toBe(403)
  }
})

test('an extra reaches an open window at the next page, without signing in again', async ({ adminPage, leadPage }) => {
  await open(leadPage, 'time', 'Time')
  await open(adminPage, 'team', 'Team')
  const { people } = await api<{ people: { id: number; email: string }[] }>(adminPage, 'GET', 'people')
  const lead = people.find(({ email }) => email === 'lead@jet.demo')
  await open(adminPage, `team/${lead?.id}`, 'Jordan Test')
  await adminPage.getByRole('checkbox', { name: 'Create, edit, send, delete invoices' }).check()
  await adminPage.getByRole('button', { name: 'Save access' }).click()
  await expect(adminPage.getByText('Access saved')).toBeVisible()
  await mainNav(leadPage).getByRole('link', { name: 'Projects' }).click()
  await expect(mainNav(leadPage).getByRole('link', { name: 'Invoices' })).toBeVisible()
  await adminPage.getByRole('checkbox', { name: 'Create, edit, send, delete invoices' }).uncheck()
  await adminPage.getByRole('button', { name: 'Save access' }).click()
  await mainNav(leadPage).getByRole('link', { name: 'Clients' }).click()
  await expect(mainNav(leadPage).getByRole('link', { name: 'Invoices' })).toBeHidden()
})

for (const width of [320, 305]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the phone header has room at ${width}px, ${colorScheme}`, async ({ adminPage }) => {
      await adminPage.emulateMedia({ colorScheme })
      await adminPage.setViewportSize({ width, height: 700 })
      await open(adminPage, 'time', 'Time')
      const name = await adminPage.locator('.shell-header-brand .brand-name').boundingBox()
      const avatar = await adminPage.locator('.account-button .avatar').boundingBox()
      const button = await adminPage.locator('.account-button').boundingBox()
      expect(avatar && name && avatar.x - (name.x + name.width)).toBeGreaterThanOrEqual(8)
      expect(avatar && button && avatar.x >= button.x && avatar.x + avatar.width <= button.x + button.width).toBe(true)
      expect(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  }
}
