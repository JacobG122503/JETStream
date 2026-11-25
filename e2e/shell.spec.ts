import { expect, settled, test } from './fixtures'
import { allPages, desktop, dialog, expectNoSidewaysScroll, expectSameDocument, mainNav, markDocument, open, pageTitle, phone, sections } from './pages'

test.use({ account: 'admin' })

// Everything here runs at both base paths.

test.describe('at 1440px', () => {
  test.use({ viewport: desktop })

  test('the root leads to Home, and Back does not bounce', async ({ page, appUrl }) => {
    await page.goto('about:blank')
    await open(page, '', 'Home')
    await expect(page).toHaveURL(`${appUrl}home`)
    await expect(page).toHaveTitle('Home | JETStream')
    const links = mainNav(page).getByRole('link')
    await expect(links).toHaveText(sections.map(([, label]) => label))
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText('Home')
    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })

  test('links have the base path, change page without reloading, and Back and Forward work', async ({ page, appUrl, basePath }) => {
    await open(page, '', 'Home')
    await markDocument(page)
    for (const [path, label] of sections) {
      const link = mainNav(page).getByRole('link', { name: label, exact: true })
      await expect(link).toHaveAttribute('href', basePath + path)
      await link.click()
      await expect(page).toHaveURL(appUrl + path)
      await expect(pageTitle(page)).toHaveText(label)
      await expect(page).toHaveTitle(`${label} | JETStream`)
      await expect(link).toHaveAttribute('aria-current', 'page')
      await expect(mainNav(page).locator('[aria-current]')).toHaveCount(1)
    }
    await page.goBack()
    await expect(pageTitle(page)).toHaveText('Reports')
    await page.goBack()
    await expect(pageTitle(page)).toHaveText('Approvals')
    await page.goForward()
    await expect(pageTitle(page)).toHaveText('Reports')
    await expectSameDocument(page)
  })

  test('a Ctrl or Cmd click opens the page in a new tab', async ({ page, context, appUrl }) => {
    await open(page, 'time', 'Timesheet')
    const newTab = context.waitForEvent('page')
    await mainNav(page).getByRole('link', { name: 'Reports' }).click({ modifiers: ['ControlOrMeta'] })
    await expect(await newTab).toHaveURL(`${appUrl}reports`)
    await expect(pageTitle(await newTab)).toHaveText('Reports')
    await expect(page).toHaveURL(`${appUrl}time`)
  })

  test('the current item is marked by more than colour', async ({ page }) => {
    await open(page, 'time', 'Timesheet')
    const look = (name: string) =>
      mainNav(page)
        .getByRole('link', { name, exact: true })
        .evaluate((link) => [getComputedStyle(link).fontWeight, getComputedStyle(link, '::after').content])
    expect(await look('Timesheet')).not.toEqual(await look('Reports'))
  })

  test('navigation stays in view while the page scrolls', async ({ page }) => {
    await open(page, 'design')
    await page.evaluate(() => window.scrollTo(0, 3000))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(3000)
    for (const [, label] of sections) {
      await expect(mainNav(page).getByRole('link', { name: label, exact: true })).toBeInViewport({ ratio: 1 })
    }
  })

  test('changing page moves focus to the heading and scrolls up; query and fragment do neither', async ({ page }) => {
    await open(page, 'design')
    await page.getByRole('link', { name: 'Tables', exact: true }).click()
    await expect(page).toHaveURL(/design#tables$/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500)
    await expect(pageTitle(page)).not.toBeFocused()
    await mainNav(page).getByRole('link', { name: 'Clients' }).click()
    await expect(pageTitle(page)).toHaveText('Clients')
    await expect(pageTitle(page)).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.goBack()
    await expect(pageTitle(page)).toHaveText('Design system')
    await expect(pageTitle(page)).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('at 1280x720 and in a low window every item can be reached', async ({ page }) => {
    for (const height of [720, 400]) {
      await page.setViewportSize({ width: 1280, height })
      await open(page, 'time', 'Timesheet')
      const settings = mainNav(page).getByRole('link', { name: 'Settings' })
      await settings.focus()
      await expect(settings).toBeInViewport({ ratio: 1 })
    }
  })
})

test.describe('at 375px', () => {
  test.use({ viewport: phone })

  test('the drawer keeps focus, and choosing an item goes to its page', async ({ page, appUrl }) => {
    await open(page, 'time', 'Timesheet')
    await expect(mainNav(page)).toBeHidden()
    const button = page.getByRole('button', { name: 'Menu', exact: true })
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await button.click()
    const drawer = dialog(page, 'Main menu')
    await expect(drawer).toBeVisible()
    await expect(page.locator('.shell-menu-button')).toHaveAttribute('aria-expanded', 'true')
    await expect(mainNav(page).getByRole('link')).toHaveText(sections.map(([, label]) => label))
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true)
      seen.add(await page.evaluate(() => document.activeElement?.textContent || (document.activeElement?.getAttribute('aria-label') ?? '')))
      await page.keyboard.press(i < 14 ? 'Tab' : 'Shift+Tab')
    }
    expect(seen.size).toBe(15)
    await mainNav(page).getByRole('link', { name: 'Invoices' }).click()
    await expect(drawer).toBeHidden()
    await expect(page).toHaveURL(`${appUrl}invoices`)
    await expect(pageTitle(page)).toHaveText('Invoices')
    await expect(pageTitle(page)).toBeFocused()
  })

  test('the drawer closes with Escape, its button and a tap outside, and focus returns', async ({ page }) => {
    await open(page, 'time', 'Timesheet')
    const button = page.getByRole('button', { name: 'Menu', exact: true })
    const drawer = dialog(page, 'Main menu')
    for (const close of [
      () => page.keyboard.press('Escape'),
      () => page.getByRole('button', { name: 'Close menu' }).click(),
      () => page.mouse.click(360, 400),
    ]) {
      await button.click()
      await expect(drawer).toBeVisible()
      await close()
      await expect(drawer).toBeHidden()
      await expect(button).toBeFocused()
    }
  })

  test('the page behind the drawer can be neither scrolled nor focused', async ({ page }) => {
    await open(page, 'design')
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.mouse.move(350, 500)
    await page.mouse.wheel(0, 800)
    await page.mouse.move(100, 500)
    await page.mouse.wheel(0, 800)
    await page.waitForTimeout(200)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.evaluate(() => document.querySelector<HTMLElement>('main button')?.focus())
    await expect(dialog(page, 'Main menu')).toBeVisible()
    expect(await page.evaluate(() => document.activeElement?.closest('main'))).toBeNull()
  })

  test('growing the window with the drawer open leaves the page usable', async ({ page }) => {
    await open(page, 'design')
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await expect(dialog(page, 'Main menu')).toBeVisible()
    await page.setViewportSize(desktop)
    await expect(dialog(page, 'Main menu')).toBeHidden()
    await page.mouse.move(700, 400)
    await page.mouse.wheel(0, 600)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await mainNav(page).getByRole('link', { name: 'Team' }).click()
    await expect(pageTitle(page)).toHaveText('Team')
  })
})

test('every page can be opened and reloaded directly, styled, with every file found', async ({ page }) => {
  for (const [path, heading] of allPages) {
    await open(page, path, heading)
    await page.reload()
    await expect(pageTitle(page)).toHaveText(heading)
    await settled(page)
    await open(page, path, heading)
    await expect(page).toHaveTitle(`${heading} | JETStream`)
    await expect(page.locator('h1')).toHaveCount(1)
    expect(await pageTitle(page).evaluate((h1) => getComputedStyle(h1).fontFamily), path).toContain('Geist Variable')
    expect(await page.evaluate(() => document.fonts.check('16px "Geist Variable"')), path).toBe(true)
  }
})

test('a trailing slash shows the same page, marked current', async ({ page }) => {
  for (const [path, heading] of [['time/', 'Timesheet'], ['projects/', 'Projects']] as const) {
    await open(page, path, heading)
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText(heading)
  }
  await open(page, 'design/plain/', 'Layout without navigation')
})

test('an unknown address shows "Page not found" inside the shell, with a link to Time', async ({ page, appUrl }) => {
  for (const path of ['nope', 'time/nope', 'no/such/page/']) {
    await open(page, path, 'Page not found')
    await expect(mainNav(page)).toBeVisible()
    await page.reload()
    await expect(pageTitle(page)).toHaveText('Page not found')
    await page.getByRole('link', { name: 'Go to Time' }).click()
    await expect(page).toHaveURL(`${appUrl}time`)
    await expect(pageTitle(page)).toHaveText('Timesheet')
  }
})

test('the skip link is first and leads to the content without a new address or document', async ({ page, appUrl }) => {
  for (const path of ['reports?x=1', 'design/plain?x=1']) {
    await open(page, path)
    await markDocument(page)
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport({ ratio: 1 })
    await page.keyboard.press('Enter')
    await expect(page.locator('main')).toBeFocused()
    await expect(page).toHaveURL(appUrl + path)
    await expectSameDocument(page)
  }
})

test('visiting every page is quiet', async ({ page, pageProblems }) => {
  for (const viewport of [phone, desktop]) {
    await page.setViewportSize(viewport)
    for (const [path, heading] of allPages) await open(page, path, heading)
  }
  expect(pageProblems).toEqual([])
})

test('no page scrolls sideways at any width', async ({ page }) => {
  await open(page, 'design')
  for (const width of [320, 375, 639, 640, 768, 1023, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    for (const path of ['time', 'nope', 'design/plain', 'design']) {
      await open(page, path)
      await expectNoSidewaysScroll(page, `${path} at ${width}`)
    }
  }
})

test.describe('touch targets', () => {
  for (const width of [320, 768, 1023]) {
    test(`are at least 44px high at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await open(page, 'design')
      const small = await page.evaluate(() => {
        const found: string[] = []
        for (const element of document.querySelectorAll<HTMLElement>('button, .btn, input, select, textarea')) {
          if (!element.checkVisibility()) continue
          // A checkbox, radio button or switch is pressed through its label.
          const target = element.matches('[type="checkbox"], [type="radio"]') ? (element.closest('label') ?? element) : element
          const { width: w, height: h } = target.getBoundingClientRect()
          const name = `${element.tagName} ${element.getAttribute('aria-label') ?? element.textContent} ${w}x${h}`
          if (h < 43.99) found.push(name)
          if (element.classList.contains('btn-icon') && w < 43.99) found.push(name)
        }
        return found
      })
      expect(small).toEqual([])
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      for (const item of await dialog(page, 'Main menu').locator('a, button').all()) {
        expect((await item.boundingBox())?.height).toBeGreaterThanOrEqual(43.99)
      }
    })
  }
})

test('print hides the shell and is light, also in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  for (const choice of ['System', 'Dark']) {
    await page.emulateMedia({ media: 'screen' })
    await open(page, 'design')
    await page.getByRole('button', { name: /^Appearance/ }).click()
    await page.getByRole('menuitemradio', { name: choice }).click()
    await page.getByRole('button', { name: 'Error', exact: true }).click()
    await expect(page.locator('.toast')).toHaveCount(1)
    await page.emulateMedia({ media: 'print' })
    for (const selector of ['.shell-sidebar', '.shell-header', '.toasts']) await expect(page.locator(selector)).toBeHidden()
    expect(await page.locator('button:visible, .btn:visible').count()).toBe(0)
    await expect(page.locator('.table-box').first().locator('th').getByText('Hours').last()).toBeVisible()
    expect(await page.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).color])).toEqual([
      'rgb(255, 255, 255)',
      'rgb(0, 0, 0)',
    ])
    // Also at once, not at the end of a transition.
    expect(await page.locator('#forms .check').nth(2).evaluate((field) => getComputedStyle(field).backgroundColor)).toBe('rgb(255, 255, 255)')
  }
})

test('with reduced motion nothing moves', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const longest = () =>
    page.evaluate(() =>
      Math.max(
        0,
        ...document.getAnimations().map((animation) => Number(animation.effect?.getComputedTiming().activeDuration ?? 0)),
        ...[...document.querySelectorAll('*')].flatMap((element) =>
          ['', '::before', '::after'].flatMap((pseudo) => {
            const style = getComputedStyle(element, pseudo)
            const durations = [style.transitionDuration, style.animationName === 'none' ? '0s' : style.animationDuration]
            return durations.flatMap((text) => text.split(',').map((part) => parseFloat(part) * 1000))
          }),
        ),
      ),
    )
  await open(page, 'design')
  expect(await longest()).toBeLessThanOrEqual(10)
  await page.getByRole('button', { name: 'Open a dialog' }).click()
  await page.getByRole('button', { name: 'Raise a toast' }).click()
  expect(await longest()).toBeLessThanOrEqual(10)
})
