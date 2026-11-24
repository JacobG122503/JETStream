import { test as base, expect } from '@playwright/test'
import { findFreePort, startServerProcess } from '../src/server/testing/serverProcess'

/*
 * The built server is started for each worker, with its own in-memory database, at the base
 * path of the project ("/" or "/jettime/"). Addresses in specs are relative to the base path
 * and have no leading slash: page.goto('') is the home page, page.goto('a/b') a deep link,
 * request.get('api/health') an API call.
 */

interface Fixtures {
  /** Problems seen on the page. Fails the test if any are left; remove the ones you expect. */
  pageProblems: string[]
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

  pageProblems: [
    async ({ page, appUrl }, use) => {
      const problems: string[] = []
      const { origin } = new URL(appUrl)
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.protocol.startsWith('http') && url.origin !== origin) problems.push(`third party: ${request.url()}`)
      })
      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type())) problems.push(`console ${message.type()}: ${message.text()}`)
      })
      page.on('pageerror', (error) => problems.push(`uncaught error: ${error.message}`))
      page.on('requestfailed', (request) =>
        problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`),
      )
      page.on('response', (response) => {
        if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`)
      })
      await use(problems)
      expect(problems, 'failed requests, requests to others, console errors and warnings').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
