import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dataRoot } from '../paths'
import { parseDemoCommand } from './guard'

const url = 'postgres://u:hunter2@127.0.0.1:1/jet'

describe('demo-data commands', () => {
  it('use the development or demo database', () => {
    expect(parseDemoCommand(['seed'], {})).toEqual({
      action: 'seed', database: { kind: 'embedded', dataDir: join(dataRoot, 'dev') }, name: 'dev', today: undefined,
      confirmed: false,
    })
    expect(parseDemoCommand(['reset', '--demo', '--yes', '--today=2028-02-29'], {})).toEqual({
      action: 'reset', database: { kind: 'embedded', dataDir: join(dataRoot, 'demo') }, name: 'demo', today: '2028-02-29',
      confirmed: true,
    })
  })

  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['DATABASE_URL', { DATABASE_URL: url }],
    ...['yes', '1', 'TRUE', 'True', ' true', 'true ', ''].map((value) => [
      `ALLOW_DEMO_DATA="${value}"`, { NODE_ENV: 'production', DATABASE_URL: url, ALLOW_DEMO_DATA: value },
    ] as const),
  ] as const)('are refused with %s, naming the override and no password', (_name, env) => {
    for (const args of [['seed'], ['reset'], ['reset', '--yes'], ['reset', '--demo', '--yes']]) {
      let message = ''
      try {
        parseDemoCommand(args, env)
      } catch (error) {
        message = String(error)
      }
      expect(message).toContain('ALLOW_DEMO_DATA=true')
      expect(message).not.toContain('hunter2')
    }
  })

  it('can be allowed on a server', () => {
    const env = { NODE_ENV: 'production', DATABASE_URL: url, ALLOW_DEMO_DATA: 'true' }
    expect(parseDemoCommand(['reset'], env)).toMatchObject({ database: { kind: 'postgres', url }, name: 'jet' })
    expect(() => parseDemoCommand(['reset', '--demo'], env)).toThrow('Unset DATABASE_URL')
    expect(() => parseDemoCommand(['seed'], { ...env, DATABASE_URL: '' })).toThrow('DATABASE_URL is required')
    expect(() => parseDemoCommand(['seed'], { ...env, DATABASE_URL: 'mysql://u:hunter2@h/x' })).toThrow('must start with')
  })

  it.each([['--today=2026-02-30'], ['--today=yesterday'], ['--today='], ['--today=2026-2-3']])('refuse %s', (option) => {
    expect(() => parseDemoCommand(['seed', option], {})).toThrow('--today must be a date')
  })

  it.each([[[]], [['drop']], [['seed', 'extra']], [['seed', '--force']]])('refuse %j', (args) => {
    expect(() => parseDemoCommand(args, {})).toThrow()
  })
})
