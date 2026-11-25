import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import type axe from 'axe-core'
import { expect, test } from './fixtures'
import { allPages, desktop, dialog, expectNoSidewaysScroll, open, pageTitle, phone, signedOutPages } from './pages'
import { accountButton, api, goodPassword, inviteLink, newEmail, signIn } from './people'

test.use({ account: 'admin' })

test.skip(({ basePath }) => basePath !== '/', 'once is enough')

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

async function scan(page: Page, what: string, within?: string) {
  await page.evaluate(axeSource)
  const violations = await page.evaluate(async ({ runOnly, context }) => {
    const { axe: engine } = window as unknown as { axe: typeof axe }
    const results = await engine.run(context ?? document, { runOnly, resultTypes: ['violations'] })
    return results.violations.flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')}: ${node.failureSummary}`),
    )
  }, { runOnly: tags, context: within })
  expect(violations, what).toEqual([])
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [phone, desktop]) {
    test.describe(`${colorScheme}, ${viewport.width}px`, () => {
      // Without motion nothing is half transparent while it is measured.
      test.use({ colorScheme, viewport, contextOptions: { reducedMotion: 'reduce' } })

      for (const [path, heading] of allPages) {
        test(path, async ({ page }) => {
          await open(page, path, heading)
          await scan(page, path)
        })
      }

      test('with things open', async ({ page }) => {
        await open(page, 'design')
        if (viewport.width < 1024) {
          await page.getByRole('button', { name: 'Menu', exact: true }).click()
          await expect(dialog(page, 'Main menu')).toBeVisible()
          await scan(page, 'drawer')
          await page.keyboard.press('Escape')
        }
        await page.getByRole('button', { name: 'Sample actions' }).click()
        await scan(page, 'menu')
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: /^Appearance/ }).click()
        await scan(page, 'appearance menu')
        await page.keyboard.press('Escape')
        await page.getByRole('combobox', { name: 'Project', exact: true }).click()
        await page.keyboard.press('ArrowDown')
        await scan(page, 'combobox')
        await page.keyboard.type('zzz')
        await scan(page, 'combobox without matches')
        await page.keyboard.press('Escape')
        await page.getByRole('combobox', { name: 'Projects' }).click()
        await scan(page, 'combobox for several')
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Choose Work date from a calendar' }).click()
        await scan(page, 'date picker')
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Check the sample form' }).click()
        await scan(page, 'error summary')
        await page.getByRole('button', { name: 'Button with a tooltip' }).focus()
        await expect(page.getByRole('tooltip')).toBeVisible()
        await scan(page, 'tooltip')
        for (const name of ['Success', 'Warning', 'Error']) await page.getByRole('button', { name, exact: true }).click()
        await expect(page.getByRole('alert').filter({ hasText: 'The sample could not be saved' })).toBeVisible()
        // Only the toasts: for as long as they are there, they cover what is behind them.
        await scan(page, 'toasts', '.toasts')
        const dismiss = page.getByRole('button', { name: /^Dismiss/ })
        while ((await dismiss.count()) > 0) await dismiss.last().click()
        await page.getByRole('button', { name: 'Open a long dialog' }).click()
        await scan(page, 'dialog')
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Delete a sample that fails' }).click()
        await dialog(page).getByRole('button', { name: 'Delete sample' }).click()
        await scan(page, 'confirmation, busy')
        await expect(dialog(page).getByRole('alert')).toBeVisible()
        await scan(page, 'confirmation, failed')
      })

      test('hovered and focused', async ({ page }) => {
        await open(page, 'design')
        for (const target of [
          page.locator('#buttons .btn-primary').first(),
          page.locator('#buttons .btn-secondary').first(),
          page.locator('#buttons .btn-quiet').first(),
          page.locator('#buttons .btn-destructive').first(),
          page.getByRole('tab', { name: 'Tasks' }),
          page.locator('#tables tbody tr').first(),
          ...(viewport.width >= 1024 ? [page.locator('.nav-link').first()] : []),
        ]) {
          await target.hover()
          await scan(page, `hover ${await target.textContent()}`)
        }
        await page.getByRole('checkbox', { name: /^Select Wen Zhao/ }).first().check()
        await scan(page, 'selected row')
      })
    })
  }
}

test('everything in the gallery can be reached with Tab and shows focus', async ({ page }) => {
  await page.setViewportSize(desktop)
  await open(page, 'design')
  const expected = await page.evaluate(() => {
    const groups = new Set<string>()
    return [...document.querySelectorAll<HTMLInputElement>('a[href], button, input, select, textarea, [tabindex="0"]')].filter((element) => {
      if (element.tabIndex < 0 || element.disabled || !element.checkVisibility()) return false
      if (element.type !== 'radio') return true
      if (groups.has(element.name)) return false
      groups.add(element.name)
      return true
    }).length
  })
  const seen = new Set<string>()
  const withoutIndicator: string[] = []
  for (let i = 0; i < expected + 20; i++) {
    await page.keyboard.press('Tab')
    const focus = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null
      if (!element || element === document.body) return null
      const counter = window as unknown as { nextMark?: number }
      element.dataset.tab ??= String((counter.nextMark = (counter.nextMark ?? 0) + 1))
      const style = getComputedStyle(element)
      return { id: element.dataset.tab, visible: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2, html: element.outerHTML.slice(0, 120) }
    })
    if (!focus) break
    seen.add(focus.id)
    if (!focus.visible) withoutIndicator.push(focus.html)
  }
  expect(withoutIndicator).toEqual([])
  expect(seen.size).toBeGreaterThanOrEqual(expected)
})

/** Every screen of accounts and people, one after another. The page is signed in as administrator. */
async function* accountScreens(page: Page, appUrl: string) {
  await open(page, 'team', 'Team')
  const { link } = await inviteLink(page)
  await open(page, 'team', 'Team')
  await expect(page.getByRole('link', { name: 'Casey Lindgren' })).toBeVisible()
  yield 'people'
  for (const tab of ['requests', 'invites', 'help']) {
    await open(page, `team?tab=${tab}`, 'Team')
    yield tab
  }
  await open(page, 'team?tab=requests', 'Team')
  await page.getByRole('button', { name: /^Approve/ }).first().click()
  await expect(dialog(page).getByLabel(/^Role/)).toBeVisible()
  yield 'approve'
  await open(page, 'team?tab=invites', 'Team')
  await page.getByRole('button', { name: 'Invite someone' }).click()
  await expect(dialog(page).getByLabel(/^Role/)).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Make invite link' }).click()
  await expect(dialog(page).getByRole('group', { name: /problems$/ })).toBeFocused()
  yield 'invite with errors'
  await open(page, 'team?tab=invites', 'Team')
  await page.getByRole('button', { name: /^New link for/ }).first().click()
  await dialog(page).getByRole('button', { name: 'Make a new link' }).click()
  await expect(dialog(page, 'Invite link')).toBeVisible()
  yield 'link'
  await open(page, 'team', 'Team')
  await page.getByRole('link', { name: 'Casey Lindgren' }).click()
  await expect(pageTitle(page)).toHaveText('Casey Lindgren')
  yield 'person'
  await open(page, 'account', 'Account')
  await accountButton(page).click()
  yield 'account menu'
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(pageTitle(page)).toHaveText('Sign in')
  yield 'sign in after signing out'
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('group', { name: /problems$/ })).toBeFocused()
  yield 'sign in with errors'
  for (const [path, heading] of signedOutPages) {
    await open(page, path, heading)
    yield path
  }
  await page.goto(`${appUrl}sign-in`)
  // Another link: the first was replaced above.
  await page.getByRole('button', { name: /^Administrator/ }).click()
  await expect(pageTitle(page)).toHaveText('Time')
  const pending = newEmail()
  const fresh = await inviteLink(page)
  expect(link).not.toBe(fresh.link)
  await page.goto(fresh.link)
  await page.getByRole('button', { name: 'Sign out and go on' }).click()
  await expect(page.getByRole('textbox', { name: /^Password/ })).toBeVisible()
  yield 'accept an invite'
  await api(page, 'POST', 'sign-up', { name: 'Pat Fictional', email: pending, password: goodPassword, timeZone: 'UTC' })
  await signIn(page, pending)
  await expect(pageTitle(page)).toHaveText('Waiting for approval')
  yield 'waiting'
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [phone, desktop]) {
    test.describe(`accounts and people, ${colorScheme}, ${viewport.width}px`, () => {
      test.use({ colorScheme, viewport, contextOptions: { reducedMotion: 'reduce' } })
      test.slow()
      test('have no violations', async ({ page, appUrl, pageProblems }) => {
        for await (const screen of accountScreens(page, appUrl)) await scan(page, screen)
        expect(pageProblems).toEqual([])
      })
    })
  }
}

for (const width of [320, 375, 1440]) {
  test.describe(`accounts and people at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })
    test.slow()
    test('do not scroll sideways, and have large enough touch targets', async ({ page, appUrl }) => {
      for await (const screen of accountScreens(page, appUrl)) {
        await expectNoSidewaysScroll(page, screen)
        if (width >= 1024) continue
        const small = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('button, .btn, input, select')]
            .filter((element) => element.checkVisibility() && !element.closest('.sr-only') && !element.classList.contains('sr-only'))
            .map((element) => (element.matches('[type="checkbox"]') ? (element.closest('label') ?? element) : element))
            .filter((element) => element.getBoundingClientRect().height < 43.99)
            .map((element) => `${element.tagName} ${element.textContent} ${element.getBoundingClientRect().height}`),
        )
        expect(small, screen).toEqual([])
      }
    })
  })
}
