import { defineConfig, devices } from '@playwright/test'
import type { WorkerOptions } from './e2e/fixtures'

const chromium = devices['Desktop Chrome']

// Every spec runs at both base paths against the same build; see e2e/fixtures.ts.
export default defineConfig<object, WorkerOptions>({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'root', use: { ...chromium, basePath: '/' } },
    { name: 'base path', use: { ...chromium, basePath: '/jettime/' } },
  ],
})
