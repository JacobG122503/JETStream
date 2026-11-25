import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { open, pageTitle } from './pages'

test.use({ account: 'admin' })

// Everything here runs at both base paths.

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
const light = 'rgb(255, 255, 255)'
const dark = 'rgb(28, 27, 26)'

async function choose(page: Page, choice: string) {
  await page.getByRole('button', { name: /^Appearance/ }).click()
  await page.getByRole('menuitemradio', { name: choice }).click()
}

/** Notes the mode at the time <body> begins, before which nothing can be painted, and in each frame. */
async function watchFirstFrames(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    Object.assign(window, { seenModes: seen })
    const note = () => {
      if (document.body) seen.push(document.documentElement.getAttribute('data-theme') ?? 'none')
    }
    new MutationObserver((_, observer) => {
      if (!document.body) return
      note()
      observer.disconnect()
    }).observe(document, { childList: true, subtree: true })
    const onFrame = () => {
      note()
      if (seen.length < 10) requestAnimationFrame(onFrame)
    }
    requestAnimationFrame(onFrame)
  })
}
const seenModes = (page: Page) => page.evaluate(() => [...new Set((window as unknown as { seenModes: string[] }).seenModes)])

test('System follows the operating system without a reload; a choice overrides it and lasts', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await open(page, 'time')
  await expect(page.getByRole('button', { name: 'Appearance: System' })).toBeVisible()
  expect(await background(page)).toBe(dark)
  await page.emulateMedia({ colorScheme: 'light' })
  expect(await background(page)).toBe(light)

  await choose(page, 'Dark')
  expect(await background(page)).toBe(dark)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')
  await watchFirstFrames(page)
  await page.reload()
  await expect(pageTitle(page)).toBeVisible()
  expect(await seenModes(page)).toEqual(['dark'])
  expect(await background(page)).toBe(dark)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  expect(await background(page)).toBe(dark)

  const tab = await context.newPage()
  await tab.goto(page.url())
  await expect(pageTitle(tab)).toBeVisible()
  expect(await background(tab)).toBe(dark)
  await choose(tab, 'Light')
  await expect(page.getByRole('button', { name: 'Appearance: Light' })).toBeVisible()
  expect(await background(page)).toBe(light)
})

test('the choice is applied before the first paint under a strict script policy, also on a deep page', async ({ page, appUrl }) => {
  await page.route(`${appUrl}design/plain`, async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "script-src 'self'" } })
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await watchFirstFrames(page)
  await open(page, 'design/plain')
  await choose(page, 'Dark')
  await page.reload()
  await expect(pageTitle(page)).toBeVisible()
  expect(await seenModes(page)).toEqual(['dark'])
  expect(await background(page)).toBe(dark)
})

test('with storage blocked the app loads, and the control works for this visit', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await open(page, 'time')
  await choose(page, 'Dark')
  expect(await background(page)).toBe(dark)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Team' }).click()
  await expect(page.getByRole('button', { name: 'Appearance: Dark' })).toBeVisible()
})

test('an unknown stored value is System', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jetstream.theme', 'purple'))
  await page.emulateMedia({ colorScheme: 'dark' })
  await open(page, 'time')
  await expect(page.getByRole('button', { name: 'Appearance: System' })).toBeVisible()
  expect(await background(page)).toBe(dark)
})

test('what is stored has a prefix', async ({ page }) => {
  await open(page, 'time')
  await choose(page, 'Dark')
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['jetstream.theme'])
})
