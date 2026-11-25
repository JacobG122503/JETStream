import type { Locator, Page } from '@playwright/test'
import { expect, signInAs, test } from './fixtures'
import { dialog, expectNoSidewaysScroll, open, signedOutPages } from './pages'

// Everything here runs at both base paths.

/** The name is there once, on one line, inside the window, and nothing covers or cuts off any of it. */
async function expectWholeName(page: Page, brand: Locator, what: string) {
  const name = brand.locator('.brand-name')
  await expect(name, what).toHaveText('JETStream')
  await expect(name, what).toBeInViewport({ ratio: 1 })
  const problems = await name.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const lines = [...range.getClientRects()]
    const [line] = lines
    if (!line || lines.length > 1) return [`${lines.length} lines`]
    const at = (x: number) => element.contains(document.elementFromPoint(x, line.top + line.height / 2))
    const steps = Array.from({ length: 21 }, (_, i) => line.left + 0.5 + ((line.width - 1) * i) / 20)
    const found = steps.filter((x) => !at(x)).map((x) => `covered or cut off at ${x}`)
    if (element.scrollWidth > element.clientWidth) found.push(`text ${element.scrollWidth} in ${element.clientWidth}`)
    return found
  })
  expect(problems, what).toEqual([])
  await expectNoSidewaysScroll(page, what)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme, contextOptions: { reducedMotion: 'reduce' } })

    for (const width of [320, 375, 1440]) {
      test(`the brand reads JETStream, whole, at ${width}px`, async ({ page, context, appUrl }) => {
        await page.setViewportSize({ width, height: 800 })
        await open(page, 'sign-in', 'Sign in')
        await expectWholeName(page, page.locator('.plain-header'), 'signed out')
        await expect(page.locator('.plain-header')).toContainText('by JET Engineering')

        await signInAs(context, appUrl, 'admin')
        await open(page, 'time', 'Time')
        if (width >= 1024) {
          await expectWholeName(page, page.locator('.shell-sidebar'), 'sidebar')
          await expect(page.locator('.shell-sidebar').getByText('by JET Engineering')).toBeVisible()
          return
        }
        await expectWholeName(page, page.locator('.shell-header-brand'), 'header')
        await page.getByRole('button', { name: 'Menu', exact: true }).click()
        await expectWholeName(page, dialog(page, 'Main menu'), 'drawer')
        await expect(dialog(page, 'Main menu').getByText('by JET Engineering')).toBeVisible()
      })
    }
  })
}

test('the title is JETStream as served, and follows the page after that', async ({ page, request }) => {
  for (const path of ['', 'time', 'sign-in', 'no/such/page']) {
    expect(await (await request.get(path)).text(), path).toContain('<title>JETStream</title>')
  }
  for (const [path, heading] of signedOutPages) {
    await open(page, path, heading)
    await expect(page).toHaveTitle(/^[^|]+ \| JETStream$/)
  }
})
