import type { Browser, Page } from '@playwright/test'
import { expect, watch } from './fixtures'
import { open } from './pages'

/** Makes a person through the pages' own API, as the administrator signed in on the page. */
export async function api<T>(page: Page, method: string, route: string, body?: object): Promise<T> {
  return page.evaluate(
    async (call) => {
      const base = document.querySelector<HTMLMetaElement>('meta[name="base-path"]')?.content ?? '/'
      const session = (await (await fetch(`${base}api/session`)).json()) as { csrfToken: string | null }
      const response = await fetch(`${base}api/${call.route}`, {
        method: call.method,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken ?? '' },
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
      })
      if (!response.ok) throw new Error(`${call.method} ${call.route}: ${response.status} ${await response.text()}`)
      return (await response.json()) as never
    },
    { method, route, body },
  )
}

let counter = 0
export const newEmail = () => `person${++counter}.${Date.now() % 1e6}@client.example`
export const goodPassword = 'correct horse battery'

interface Options {
  roles: { id: number; key: string }[]
  clients: { id: number; name: string; projects: { id: number; name: string }[] }[]
}

export const options = (admin: Page) => api<Options>(admin, 'GET', 'people/options')

/** An invite link for a new person. The page must be an administrator's, anywhere in the app. */
export async function inviteLink(admin: Page, role: 'administrator' | 'manager' | 'member' = 'member', email = newEmail()) {
  const roleId = (await options(admin)).roles.find(({ key }) => key === role)?.id
  const { link } = await api<{ link: string }>(admin, 'POST', 'invites', { name: 'Robin Fictional', email, roleId })
  return { email, link }
}

/** Another browser, signed out. Its problems must be empty in the end. */
export async function newBrowser(browser: Browser, appUrl: string) {
  const context = await browser.newContext({ baseURL: appUrl })
  const page = await context.newPage()
  return { context, page, problems: watch(page, appUrl) }
}

export async function accept(page: Page, link: string) {
  await page.goto(link)
  await page.getByRole('textbox', { name: /^Password/ }).fill(goodPassword)
  await page.getByRole('button', { name: 'Accept and sign in' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home')
}

export async function signIn(page: Page, email: string, password = goodPassword) {
  if (!/\/sign-in/.test(page.url())) await open(page, 'sign-in', 'Sign in')
  await page.getByRole('textbox', { name: /^Email/ }).fill(email)
  await page.getByRole('textbox', { name: /^Password/ }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

export const accountButton = (page: Page) => page.getByRole('button', { name: /^Account: / })

export async function signOut(page: Page) {
  await accountButton(page).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in')
}
