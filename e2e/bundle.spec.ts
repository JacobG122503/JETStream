import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { webBuildDir as web } from '../src/server/paths'
import { expect, test } from './fixtures'

test('no database or server code is in the files for the browser', () => {
  const files = readdirSync(web, { recursive: true, encoding: 'utf8' }).filter((name) => /\.(js|css|html)$/.test(name))
  expect(files.length).toBeGreaterThan(2)
  for (const file of files) {
    expect(readFileSync(join(web, file), 'utf8'), file).not.toMatch(/drizzle|pglite|time_entries|password_hash/i)
  }
})
