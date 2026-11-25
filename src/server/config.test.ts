import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

const url = 'postgres://u:hunter2@127.0.0.1:1/x'

describe('loadConfig', () => {
  it('has defaults', () => {
    expect(loadConfig([], { DATABASE_URL: url, PUBLIC_URL: 'https://time.example.com' })).toEqual({
      mode: 'production',
      host: '127.0.0.1',
      port: 3000,
      basePath: '/',
      database: { kind: 'postgres', url },
      publicUrl: 'https://time.example.com/',
      trustProxy: 0,
      warnings: [],
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

  describe('PUBLIC_URL', () => {
    const production = (settings: Record<string, string>) => loadConfig([], { DATABASE_URL: url, ...settings })

    it('is required in production, after DATABASE_URL', () => {
      expect(() => production({})).toThrow('PUBLIC_URL')
      expect(() => loadConfig([], {})).toThrow('DATABASE_URL')
      expect(() => loadConfig([], { PUBLIC_URL: 'nope', TRUST_PROXY: '9' })).toThrow('DATABASE_URL')
    })

    it.each([
      'time.example.com', '/time', 'ftp://time.example.com', 'https://', 'https:time.example.com', 'javascript:alert(1)',
      'https://time.example.com/?a=1', 'https://time.example.com/#a', 'https://u:hunter2@time.example.com/', 'https://a b/',
    ])('refuses "%s"', (value) => {
      expect(() => production({ PUBLIC_URL: value })).toThrow(/^PUBLIC_URL(?!.*hunter2)/)
      expect(() => loadConfig(['--demo'], { PUBLIC_URL: value })).toThrow('PUBLIC_URL')
    })

    it.each([
      ['https://time.example.com', undefined, 'https://time.example.com/'],
      ['https://time.example.com/', '/', 'https://time.example.com/'],
      ['https://example.com/jettime', '/jettime/', 'https://example.com/jettime/'],
      ['https://example.com/jettime/', '/jettime', 'https://example.com/jettime/'],
      ['https://example.com:8443/jettime', '/jettime', 'https://example.com:8443/jettime/'],
      ['http://localhost:3000', undefined, 'http://localhost:3000/'],
      ['http://127.0.0.1:3000', undefined, 'http://127.0.0.1:3000/'],
      ['http://[::1]:3000', undefined, 'http://[::1]:3000/'],
    ])('reads %s with BASE_PATH %s as %s', (value, basePath, expected) => {
      const settings = { PUBLIC_URL: value, ...(basePath === undefined ? {} : { BASE_PATH: basePath }) }
      expect(production(settings)).toMatchObject({ publicUrl: expected, warnings: [] })
    })

    it.each([
      ['https://example.com/jettime', '/'],
      ['https://example.com/', '/jettime'],
      ['https://example.com/jettime2', '/jettime'],
      ['https://example.com/JetTime', '/jettime'],
    ])('refuses %s with BASE_PATH %s', (value, basePath) => {
      expect(() => production({ PUBLIC_URL: value, BASE_PATH: basePath })).toThrow(/PUBLIC_URL.*BASE_PATH/)
    })

    it('must be https, unless only this computer is meant or plain http is allowed, with a warning', () => {
      const settings = { PUBLIC_URL: 'http://time.example.com' }
      expect(() => production(settings)).toThrow(/PUBLIC_URL.*ALLOW_INSECURE_HTTP=true/)
      expect(() => production({ ...settings, ALLOW_INSECURE_HTTP: 'yes' })).toThrow('PUBLIC_URL')
      expect(() => production({ PUBLIC_URL: 'http://localhost.example.com' })).toThrow('PUBLIC_URL')
      const allowed = production({ ...settings, ALLOW_INSECURE_HTTP: 'true' })
      expect(allowed.publicUrl).toBe('http://time.example.com/')
      expect(allowed.warnings.join()).toContain('WARNING: ALLOW_INSECURE_HTTP')
    })

    it('is the printed address in development and demo', () => {
      expect(loadConfig(['--demo'], { PORT: '3100', BASE_PATH: '/jettime' }).publicUrl).toBe('http://127.0.0.1:3100/jettime/')
      expect(loadConfig(['--dev'], { HOST: '::1' }).publicUrl).toBe('http://[::1]:3000/')
    })
  })

  it('reads TRUST_PROXY from 0 to 5', () => {
    for (const value of ['0', '1', '5']) expect(loadConfig(['--demo'], { TRUST_PROXY: value }).trustProxy).toBe(Number(value))
    expect(loadConfig(['--demo'], {}).trustProxy).toBe(0)
    for (const value of ['6', '-1', 'true', '1.5', '10', ' 1']) {
      expect(() => loadConfig(['--demo'], { TRUST_PROXY: value })).toThrow('TRUST_PROXY')
    }
  })

  it('warns about a demo that others can reach', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.5', 'jet-laptop']) {
      expect(loadConfig(['--demo'], { HOST: host }).warnings.join()).toContain('WARNING')
    }
    for (const host of ['', '127.0.0.1', 'localhost', '::1']) expect(loadConfig(['--demo'], { HOST: host }).warnings).toEqual([])
    expect(loadConfig(['--dev'], { HOST: '0.0.0.0' }).warnings).toEqual([])
  })
})
