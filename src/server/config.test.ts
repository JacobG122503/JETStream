import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

const url = 'postgres://u:hunter2@127.0.0.1:1/x'

describe('loadConfig', () => {
  it('has defaults', () => {
    expect(loadConfig([], { DATABASE_URL: url })).toEqual({
      mode: 'production',
      host: '127.0.0.1',
      port: 3000,
      basePath: '/',
      database: { kind: 'postgres', url },
    })
  })

  it.each([
    ['/', '/'],
    ['/jettime', '/jettime/'],
    ['/jettime/', '/jettime/'],
    ['/a/b-c.d', '/a/b-c.d/'],
  ])('reads BASE_PATH %s as %s', (value, expected) => {
    expect(loadConfig(['--demo'], { BASE_PATH: value }).basePath).toBe(expected)
  })

  it.each(['jet', '', './', 'http://x/', '//x', '/a b', '/a"b', '/..', '/a/../b', '/a//'])(
    'refuses BASE_PATH "%s"',
    (value) => {
      expect(() => loadConfig(['--demo'], { BASE_PATH: value })).toThrow('BASE_PATH')
    },
  )

  it.each(['1', '65535'])('accepts PORT %s', (value) => {
    expect(loadConfig(['--demo'], { PORT: value }).port).toBe(Number(value))
  })

  it.each(['abc', '70000', '65536', '0', '-1', '80.5', '1e3', ''])('refuses PORT "%s"', (value) => {
    expect(() => loadConfig(['--demo'], { PORT: value })).toThrow('PORT')
  })

  it('requires DATABASE_URL in production, and a PostgreSQL one', () => {
    expect(() => loadConfig([], {})).toThrow('DATABASE_URL')
    expect(() => loadConfig([], { DATABASE_URL: ' ' })).toThrow('DATABASE_URL')
    expect(() => loadConfig([], { DATABASE_URL: 'mysql://u:hunter2@x/y' })).toThrow(
      /^DATABASE_URL must start with(?!.*hunter2)/,
    )
  })

  it('keeps the development and demo databases apart, and out of production', () => {
    const dev = loadConfig(['--dev'], { DATABASE_URL: url }).database
    const demo = loadConfig(['--demo'], {}).database
    expect(dev.kind).toBe('embedded')
    expect(demo.kind).toBe('embedded')
    expect(dev).not.toEqual(demo)
    expect(() => loadConfig(['--dev'], { NODE_ENV: 'production' })).toThrow('--dev')
    expect(() => loadConfig(['--data-dir', 'x'], { DATABASE_URL: url })).toThrow('--data-dir')
  })

  it('refuses DATABASE_URL in demo mode, and unknown options', () => {
    expect(() => loadConfig(['--demo'], { DATABASE_URL: url })).toThrow('DATABASE_URL')
    expect(() => loadConfig(['--nope'], {})).toThrow('--nope')
  })
})
