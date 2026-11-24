import { expect, test } from './fixtures'

test('the home page shows that the server is connected', async ({ page }) => {
  await page.goto('')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('JET Time')
  await expect(page.getByRole('status')).toHaveText('Server connected')
  await expect(page).toHaveTitle('JET Time')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/)
})

test('the home page can be reloaded, left and returned to without a failed request', async ({ page }) => {
  const heading = page.getByRole('heading', { level: 1 })
  const status = page.getByRole('status')
  await page.goto('')
  await expect(status).toHaveText('Server connected')
  await page.reload()
  await expect(status).toHaveText('Server connected')
  await page.goto('no/such/page')
  await expect(heading).toHaveText('Page not found')
  await page.getByRole('link', { name: 'Go to the home page' }).click()
  await expect(status).toHaveText('Server connected')
  await page.goBack()
  await expect(heading).toHaveText('Page not found')
  await page.goForward()
  await expect(status).toHaveText('Server connected')
  // Leaving without waiting for the answer, by a link inside the app.
  await page.goBack()
  await page.getByRole('link', { name: 'Go to the home page' }).click()
  await page.evaluate(() => history.back())
  await expect(heading).toHaveText('Page not found')
})

test('an unknown deep link shows "Page not found", also after a reload, and links home', async ({
  page,
  appUrl,
}) => {
  const heading = page.getByRole('heading', { level: 1 })
  for (const path of ['nope', 'no/such/page', 'no/such/page/']) {
    await page.goto(path)
    await expect(heading).toHaveText('Page not found')
    await page.reload()
    await expect(heading).toHaveText('Page not found')
  }
  await page.getByRole('link', { name: 'Go to the home page' }).click()
  await expect(heading).toHaveText('JET Time')
  await expect(page.getByRole('status')).toHaveText('Server connected')
  await expect(page).toHaveURL(appUrl)
})

test('an unknown API route answers 404 JSON', async ({ request }) => {
  for (const response of [await request.get('api/nope'), await request.post('api/nope/deeper')]) {
    expect(response.status()).toBe(404)
    expect(response.headers()['content-type']).toContain('application/json')
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  }
})

test('files are served under the base path, and nothing else', async ({ page, request, appUrl, basePath }) => {
  const icon = await page.goto('favicon.svg')
  expect(icon?.headers()['content-type']).toContain('image/svg+xml')
  await page.goto('no/such/page')
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', `${basePath}favicon.svg`)
  expect((await request.get('assets/missing.js')).status()).toBe(404)
  for (const path of ['package.json', 'server/main.js', '..%2fserver/main.js', '.env']) {
    expect(await (await request.get(path)).text(), path).not.toMatch(/jet-time|createServer/)
  }
  if (basePath !== '/') {
    const { origin } = new URL(appUrl)
    for (const path of ['/', '/api/health', '/favicon.svg']) {
      expect((await request.get(origin + path)).status(), path).toBe(404)
    }
    await page.goto(origin + basePath.slice(0, -1))
    await expect(page).toHaveURL(appUrl)
    await expect(page.getByRole('status')).toHaveText('Server connected')
  }
})
