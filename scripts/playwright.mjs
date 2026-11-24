// Runs the Playwright CLI with its browsers kept inside the project (.playwright-browsers),
// instead of Playwright's shared per-user cache.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(root, '.playwright-browsers') },
})
if (result.error) console.error(result.error)
process.exit(result.status ?? 1)
