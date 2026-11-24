import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import type axe from 'axe-core'
import { expect, test } from './fixtures'
import { allPages, desktop, dialog, open, phone } from './pages'

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
