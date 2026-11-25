import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { productName } from './product'

it('is spelled JETStream', () => expect(productName).toBe('JETStream'))

it('is the title of index.html, for before scripts run', () => {
  const titles = [...readFileSync('src/web/index.html', 'utf8').matchAll(/<title>(.*?)<\/title>/g)].map((match) => match[1])
  expect(titles).toEqual([productName])
})
