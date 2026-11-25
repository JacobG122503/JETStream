import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { desktop, dialog, expectNoSidewaysScroll, expectSameDocument, mainNav, markDocument, open, pageTitle, phone } from './pages'

// What the shared components do in a real browser, in the gallery. The base path does not matter.
test.use({ account: 'admin' })
test.skip(({ basePath }) => basePath !== '/', 'once is enough')

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const toasts = (page: Page) => page.locator('.toast')

async function expectInsideWindow(page: Page, element: Locator) {
  const box = await element.boundingBox()
  const size = page.viewportSize()
  if (!box || !size) throw new Error('Nothing to measure')
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(size.width)
  expect(box.y + box.height).toBeLessThanOrEqual(size.height)
}

for (const viewport of [phone, desktop]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport })
    test.beforeEach(({ page }) => open(page, 'design'))

    test('menus, lists and calendars stay inside the window', async ({ page }) => {
      await button(page, 'Actions at the edge').click()
      await expectInsideWindow(page, page.getByRole('menu'))
      await page.keyboard.press('Escape')
      await button(page, 'Menu with a long item').click()
      await expectInsideWindow(page, page.getByRole('menu'))
      await page.keyboard.press('Escape')
      await button(page, 'Choose Work date from a calendar').click()
      await expectInsideWindow(page, dialog(page, 'Calendar for Work date'))
      await page.keyboard.press('Escape')
      await page.getByRole('combobox', { name: 'One of 500 work orders' }).click()
      await expectInsideWindow(page, page.locator('.combobox-popup'))
    })

    test('a failed form leads to its fields without a new address or document', async ({ page }) => {
      await markDocument(page)
      const address = page.url()
      await button(page, 'Check the sample form').click()
      const summary = page.getByRole('group', { name: 'There are 2 problems' })
      await expect(summary).toBeFocused()
      await expect(summary.getByRole('link')).toHaveCount(2)
      await summary.getByRole('link').first().click()
      await expect(page.getByRole('textbox', { name: 'Contact name' })).toBeFocused()
      expect(page.url()).toBe(address)
      await expectSameDocument(page)
    })

    test('an error while a page renders leaves navigation working', async ({ page, pageProblems }) => {
      await button(page, 'Break this page').click()
      await expect(pageTitle(page)).toHaveText('Something went wrong')
      await expect(pageTitle(page)).toBeFocused()
      await button(page, 'Try again').click()
      await expect(pageTitle(page)).toHaveText('Design system')
      await expect(page.getByText('Server connected')).toBeVisible()
      await button(page, 'Break this page').click()
      if (viewport.width < 1024) await button(page, 'Menu').click()
      await mainNav(page).getByRole('link', { name: 'Clients' }).click()
      await expect(pageTitle(page)).toHaveText('Clients')
      // The deliberate error is reported by React; nothing else may be.
      for (const problem of pageProblems.splice(0)) expect(problem).toMatch(/Sample error: raised on purpose/)
    })

    test('a confirmation that fails stays open; a double click runs it once', async ({ page }) => {
      const opener = button(page, 'Delete a sample that fails')
      await opener.click()
      const confirm = dialog(page, 'Delete this sample?')
      await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
      const action = confirm.getByRole('button', { name: 'Delete sample' })
      await action.dblclick()
      await expect(action).toHaveAttribute('aria-busy', 'true')
      await page.keyboard.press('Escape')
      await expect(confirm.getByRole('alert')).toHaveText('Could not delete')
      await expect(action).not.toHaveAttribute('aria-disabled')
      await page.keyboard.press('Escape')
      await expect(confirm).toBeHidden()
      await expect(opener).toBeFocused()

      await button(page, 'Delete a sample').click()
      await dialog(page).getByRole('button', { name: 'Delete sample' }).dblclick()
      await expect(dialog(page)).toBeHidden()
      await expect(toasts(page)).toHaveCount(1)
    })

    test('toasts stay above a dialog and can be dismissed there, by pointer and keyboard', async ({ page }) => {
      await button(page, 'Open a dialog').click()
      for (let i = 0; i < 2; i++) await button(page, 'Raise an error').click()
      await expect(toasts(page)).toHaveCount(2)
      await toasts(page).first().getByRole('button', { name: /^Dismiss/ }).click()
      await expect(toasts(page)).toHaveCount(1)
      await button(page, 'Done').focus()
      await page.keyboard.press('Tab')
      await expect(toasts(page).getByRole('button')).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(toasts(page)).toHaveCount(0)
      await expect(button(page, 'Done')).toBeFocused()
      await expect(dialog(page, 'Sample dialog')).toBeVisible()
      // No toast left: focus goes round inside the dialog.
      await page.keyboard.press('Tab')
      await expect(dialog(page).getByRole('button', { name: 'Close' })).toBeFocused()
    })

    test('the table sorts all rows and pages through them', async ({ page }) => {
      const box = page.locator('.table-box').first()
      await expect(box.getByText('1-25 of 60')).toBeVisible()
      if (viewport.width < 640) {
        await box.getByRole('combobox', { name: 'Sort by' }).selectOption('Hours')
      } else {
        await box.getByRole('button', { name: 'Hours' }).click()
        await expect(box.getByRole('columnheader', { name: 'Hours' })).toHaveAttribute('aria-sort', 'ascending')
      }
      const hours = () => box.locator('tbody .is-numeric .cell-value').allTextContents()
      const first = (await hours()).map(Number)
      expect(first).toEqual([...first].sort((a, b) => a - b))
      await button(page, 'Next page').click()
      await button(page, 'Next page').click()
      await expect(box.getByText('51-60 of 60')).toBeVisible()
      expect((await hours()).slice(-6)).toEqual(Array(6).fill('None'))
    })
  })
}

test('in a list of 500, a low window and a dialog, the active option stays in view', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 500 })
  await open(page, 'design')
  const input = page.getByRole('combobox', { name: 'One of 500 work orders' })
  await input.fill('work order 4')
  await expect(page.locator('.option')).toHaveCount(100)
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown')
  await expect(page.locator('.option.is-active')).toBeInViewport({ ratio: 0.99 })
  await page.keyboard.press('Enter')
  await expect(input).toHaveValue('Work order 429')
  await button(page, 'Open a form dialog').click()
  await expect(page.getByRole('textbox', { name: 'Sample name' })).toBeFocused()
  await page.getByRole('combobox', { name: 'Sample project' }).click()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('.option.is-active')).toBeInViewport({ ratio: 0.99 })
  await page.keyboard.press('Escape')
  await expect(page.locator('.combobox-popup')).toBeHidden()
  await expect(dialog(page, 'Sample form dialog')).toBeVisible()
  await button(page, 'Choose Sample start from a calendar').click()
  await page.keyboard.press('Escape')
  await expect(button(page, 'Choose Sample start from a calendar')).toBeFocused()
  await page.mouse.click(5, 5)
  await expect(dialog(page, 'Sample form dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
})

test('a long dialog at 320x568 scrolls inside, with its buttons in view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await open(page, 'design')
  await button(page, 'Open a long dialog').click()
  await expect(button(page, 'Accept the sample terms')).toBeInViewport({ ratio: 1 })
  const body = page.locator('.dialog-body')
  await expect(body).toHaveAttribute('tabindex', '0')
  await body.focus()
  await page.keyboard.press('End')
  await expect(page.getByText('Sample paragraph 14.')).toBeInViewport()
  await expect(button(page, 'Cancel')).toBeInViewport({ ratio: 1 })
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden')
  await button(page, 'Cancel').click()
  await expect(button(page, 'Open a long dialog')).toBeFocused()
})

test('focus goes to a sensible place when the opener is gone', async ({ page }) => {
  await open(page, 'design')
  await button(page, 'Open, then remove this button').click()
  await button(page, 'Remove the button and close').click()
  await expect(button(page, 'Bring the button back')).toBeFocused()
})

test('three of five toasts show, the rest follow, and hovering keeps one', async ({ page }) => {
  await page.clock.install()
  await open(page, 'design')
  await button(page, 'Five at once').click()
  await page.clock.runFor(200)
  await expect(toasts(page)).toHaveCount(3)
  await expect(toasts(page).first()).toContainText('Sample message 1')
  const second = toasts(page).filter({ hasText: 'Sample message 2' })
  await second.hover()
  await page.clock.runFor(10_000)
  await expect(toasts(page)).toContainText(['Sample message 1', 'Sample message 2', 'Sample message 3'])
  await second.getByRole('button', { name: /^Dismiss/ }).click()
  await page.mouse.move(5, 5)
  await page.clock.runFor(200)
  await expect(toasts(page)).toContainText(['Sample message 1', 'Sample message 3', 'Sample message 4'])
  await page.clock.runFor(4900)
  await expect(toasts(page)).toContainText(['Sample message 5'])
  await page.clock.runFor(5000)
  await expect(toasts(page)).toHaveCount(0)
})

test('tabs that do not fit scroll inside their list', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await open(page, 'design')
  await page.getByRole('tab', { name: 'Overview' }).focus()
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: 'History' })).toBeInViewport({ ratio: 0.99 })
  await expect(page.getByRole('tab', { name: 'History' })).toBeFocused()
  await expectNoSidewaysScroll(page, 'tabs')
})

test('below 640px rows become blocks with labels, or the table scrolls in a container that takes focus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await open(page, 'design')
  const row = page.getByRole('table', { name: 'Sample time entries' }).getByRole('row').nth(0)
  await expect(row.getByRole('cell', { name: /^Person/ })).toBeVisible()
  await expect(row.locator('.cell-label').first()).toBeVisible()
  const region = page.getByRole('region', { name: 'Sample entries that scroll sideways' })
  expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
})

/** Words of the table that are broken over lines, and values that should be on one line but are not. */
const brokenText = (table: Locator) =>
  table.evaluate((element) => {
    const broken: string[] = []
    const linesOf = (range: Range) => new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top))).size
    const texts = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    while (texts.nextNode()) {
      const node = texts.currentNode
      for (const word of (node.nodeValue ?? '').matchAll(/\S+/g)) {
        const range = document.createRange()
        range.setStart(node, word.index)
        range.setEnd(node, word.index + word[0].length)
        if (linesOf(range) > 1) broken.push(word[0])
      }
    }
    for (const cell of element.querySelectorAll('tbody td')) {
      const text = cell.querySelector('.cell-value')?.textContent ?? ''
      if (!/^[A-Z][a-z]{2} \d{1,2}, \d{4}$|^\S+$/.test(text)) continue
      const range = document.createRange()
      range.selectNodeContents(cell.querySelector('.badge-text') ?? cell.querySelector('.cell-value') ?? cell)
      if (linesOf(range) > 1) broken.push(text)
    }
    return broken
  })

for (const width of [640, 768, 1024]) {
  test(`table words, badges and dates stay whole at ${width}px, and the table fits`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await open(page, 'design')
    for (const name of ['Sample time entries', 'Sample entries that scroll sideways']) {
      const table = page.getByRole('table', { name })
      await expect(table.locator('.badge-text').first()).toHaveText('Draft')
      expect(await brokenText(table), name).toEqual([])
      expect(await table.evaluate((element) => element.scrollWidth - (element.parentElement?.clientWidth ?? 0)), name).toBe(0)
    }
    // It fits, so it is not another stop for the Tab key.
    await expect(page.getByRole('region', { name: 'Sample time entries' })).toHaveCount(0)
  })
}

test('from 640px, only words that are too long for a table are broken, so that it fits', async ({ page }) => {
  for (const width of [640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await open(page, 'design')
    const table = page.getByRole('table', { name: 'Sample table with a long name' })
    expect(await table.evaluate((element) => element.scrollWidth - (element.parentElement?.clientWidth ?? 0)), `${width}`).toBe(0)
    expect([...new Set((await brokenText(table)).map((word) => word.length))]).toEqual([120])
  }
})

test('a table that does not fit scrolls in a container that takes focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, 'design')
  const region = page.getByRole('region', { name: 'Sample time entries' })
  await expect(region).toHaveCount(0)
  await page.locator('#tables .gallery-example').first().evaluate((element) => (element.style.width = '420px'))
  await expect(region).toHaveAttribute('tabindex', '0')
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await expectNoSidewaysScroll(page, 'a table that does not fit')
})

test('at 320px the caption of a table that scrolls is whole and stays', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await open(page, 'design')
  const region = page.getByRole('region', { name: 'Sample entries that scroll sideways' })
  const caption = page.locator('.table-caption', { hasText: 'Sample entries that scroll sideways' })
  await caption.scrollIntoViewIfNeeded()
  for (const left of [0, 200]) {
    await region.evaluate((element, to) => element.scrollTo(to, 0), left)
    expect(
      await caption.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        const [text, box] = [range.getBoundingClientRect(), element.closest('.table-box')?.getBoundingClientRect()]
        return box !== undefined && text.width > 100 && text.left >= box.left && text.right <= box.right
      }),
    ).toBe(true)
  }
})

test('the totals are those of the rows in the table', async ({ page }) => {
  await open(page, 'design')
  for (const [name, total] of [
    ['Sample time entries', '307.50'],
    ['Sample entries that scroll sideways', '28.50'],
  ] as const) {
    await expect(page.getByRole('table', { name }).locator('tfoot .is-numeric')).toContainText(total)
  }
})

test('icons of disabled fields look disabled', async ({ page }) => {
  await open(page, 'design')
  const wrap = (name: string, role: 'combobox' | 'searchbox') => page.locator('.control-wrap').filter({ has: page.getByRole(role, { name, exact: true }) })
  const colours = (element: Locator) =>
    element.evaluate((node) => [getComputedStyle(node.querySelector('.icon') as Element).color, getComputedStyle(node.querySelector('.control') as Element).color])
  for (const field of [wrap('Disabled role', 'combobox'), wrap('Disabled search', 'searchbox'), wrap('Disabled project', 'combobox')]) {
    const [icon, text] = await colours(field)
    expect(icon).toBe(text)
  }
  const [icon] = await colours(wrap('Role', 'combobox'))
  expect(icon).not.toBe((await colours(wrap('Disabled role', 'combobox')))[0])
})

test('the over-budget bar stays inside its track', async ({ page }) => {
  await open(page, 'design')
  const bar = page.getByRole('progressbar', { name: 'Over', exact: true })
  await expect(page.getByText('Over budget by 35%')).toBeVisible()
  const widths = await bar.evaluate((track) => [track.clientWidth, (track.firstElementChild as HTMLElement).offsetWidth])
  expect(widths[1]).toBeLessThanOrEqual(widths[0] ?? 0)
})

for (const timezoneId of ['America/Los_Angeles', 'Pacific/Auckland']) {
  test.describe(`in ${timezoneId}`, () => {
    test.use({ timezoneId })

    test('dates of clock changes are not shifted', async ({ page }) => {
      await open(page, 'design')
      const input = page.getByRole('textbox', { name: 'Work date' })
      for (const [typed, day, value] of [
        ['3/1/2026', /^Sunday, March 8, 2026/, '2026-03-08'],
        ['11/2/2026', /^Sunday, November 1, 2026/, '2026-11-01'],
      ] as const) {
        await input.fill(typed)
        await input.press('Enter')
        await button(page, 'Choose Work date from a calendar').click()
        await page.getByRole('button', { name: day }).click()
        await expect(page.getByTestId('date-value')).toHaveText(value)
      }
    })
  })
}
