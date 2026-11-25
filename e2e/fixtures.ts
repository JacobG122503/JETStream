import { test as base, type BrowserContext, expect, type Page, type Request } from '@playwright/test'
import { findFreePort, startServerProcess } from '../src/server/testing/serverProcess'

/*
 * The built server is started for each worker, with its own in-memory database, at the base
 * path of the project ("/" or "/jetstream/"). Addresses in specs are relative to the base path
 * and have no leading slash: page.goto('') is the home page, page.goto('a/b') a deep link,
 * request.get('api/health') an API call.
 *
 * `page` is signed out. `test.use({ account: 'admin' })` signs it in as that demo account. The pages
 * `adminPage`, `leadPage` and `employeePage` are signed in, each in a browser of its own, so that
 * one test can be several people.
 */

export type DemoAccount = 'admin' | 'lead' | 'employee'

export interface TestOptions {
  /** Who `page` is signed in as. */
  account: DemoAccount | null
}

interface Fixtures extends TestOptions {
  /** Problems seen on the page. Fails the test if any are left; remove the ones you expect. */
  pageProblems: string[]
  adminPage: Page
  leadPage: Page
  employeePage: Page
}

export interface WorkerOptions {
  /** Starts and ends with "/". */
  basePath: string
}

interface WorkerFixtures extends WorkerOptions {
  /** Address of the running app, ending with "/". */
  appUrl: string
}

const stopLimitMs = 5000

const running = new WeakMap<Page, Set<Request>>()

/** Waits until the page asks for nothing: leaving it earlier would cancel a request. */
export async function settled(page: Page) {
  await expect.poll(() => running.get(page)?.size ?? 0, { message: 'requests under way' }).toBe(0)
}

/** Collects whatever goes wrong on the page. */
export function watch(page: Page, appUrl: string): string[] {
  const problems: string[] = []
  const { origin } = new URL(appUrl)
  const open = new Set<Request>()
  running.set(page, open)
  page.on('request', (request) => {
    open.add(request)
    const url = new URL(request.url())
    if (url.protocol.startsWith('http') && url.origin !== origin) problems.push(`third party: ${request.url()}`)
  })
  page.on('requestfinished', (request) => open.delete(request))
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) problems.push(`console ${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`uncaught error: ${error.message}`))
  page.on('requestfailed', (request) => {
    open.delete(request)
    problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  return problems
}

/** Gives the browser a session, without opening a page. */
export async function signInAs(context: BrowserContext, appUrl: string, account: DemoAccount) {
  const response = await context.request.post(`${appUrl}api/session/demo`, { data: { account } })
  expect(response.status()).toBe(200)
}

const expectNoProblems = (problems: string[]) =>
  expect(problems, 'failed requests, requests to others, console errors and warnings').toEqual([])

export const test = base.extend<Fixtures, WorkerFixtures>({
  basePath: ['/', { scope: 'worker', option: true }],

  appUrl: [
    async ({ basePath }, use) => {
      const server = startServerProcess(['dist/server/main.js', '--demo', '--data-dir', 'memory://'], {
        PORT: String(await findFreePort()),
        BASE_PATH: basePath,
      })
      await use(await server.ready)
      const begin = Date.now()
      const exitCode = await server.stop()
      expect(exitCode, server.output()).toBe(0)
      expect(Date.now() - begin, 'time to stop').toBeLessThan(stopLimitMs)
    },
    { scope: 'worker' },
  ],

  baseURL: async ({ appUrl }, use) => use(appUrl),

  account: [null, { option: true }],

  context: async ({ context, account, appUrl }, use) => {
    if (account !== null) await signInAs(context, appUrl, account)
    await use(context)
  },

  pageProblems: [
    async ({ page, appUrl }, use) => {
      const problems = watch(page, appUrl)
      await use(problems)
      expectNoProblems(problems)
    },
    { auto: true },
  ],

  adminPage: async ({ browser, appUrl }, use) => {
    const { context, page, problems } = await openAs(await browser.newContext(), appUrl, 'admin')
    await use(page)
    await context.close()
    expectNoProblems(problems)
  },
  leadPage: async ({ browser, appUrl }, use) => {
    const { context, page, problems } = await openAs(await browser.newContext(), appUrl, 'lead')
    await use(page)
    await context.close()
    expectNoProblems(problems)
  },
  employeePage: async ({ browser, appUrl }, use) => {
    const { context, page, problems } = await openAs(await browser.newContext(), appUrl, 'employee')
    await use(page)
    await context.close()
    expectNoProblems(problems)
  },
})

async function openAs(context: BrowserContext, appUrl: string, account: DemoAccount) {
  await signInAs(context, appUrl, account)
  const page = await context.newPage()
  return { context, page, problems: watch(page, appUrl) }
}

export { expect }
