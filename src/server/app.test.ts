import { mkdir, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import http from 'node:http'
import { join } from 'node:path'
import { Router } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import type { Database, Db } from './db/database'
import { createTempDir, createTestDatabase } from './testing/testDatabase'

const notFound = { error: { code: 'not_found', message: 'Not found' } }

/** Like the errors of email, payment and accounting clients. */
class AdapterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

let database: Database
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())

async function createWebDir() {
  const dir = join(await createTempDir(), 'web')
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(
    join(dir, 'index.html'),
    '<meta name="base-path" content="./" /><script src="./assets/app.js"></script><title>App</title>',
  )
  await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1)')
  await writeFile(join(dir, 'favicon.svg'), '<svg/>')
  await writeFile(join(dir, '..', 'package.json'), 'outside')
  await writeFile(join(dir, '.env'), 'secret')
  return dir
}

async function createTestApp(basePath = '/') {
  return createApp({ db: database.db, basePath, webDir: await createWebDir() })
}

describe('health', () => {
  it('answers 200 after querying the migrated database', async () => {
    const execute = vi.spyOn(database.db, 'execute')
    const response = await request(await createTestApp()).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.type).toBe('application/json')
    expect(response.body).toEqual({ status: 'ok', database: 'ok' })
    expect(response.headers).not.toHaveProperty('x-powered-by')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('answers 503 without details when the query fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = { execute: () => Promise.reject(new Error('password=secret')) } as unknown as Db
    const response = await request(createApp({ db, basePath: '/' })).get('/api/health')
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ status: 'error', database: 'unavailable' })
    expect(response.text).not.toContain('secret')
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
  })

  it('answers 503 within 5 seconds when the database does not answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = { execute: () => new Promise(() => undefined) } as unknown as Db
    const start = Date.now()
    const response = await request(createApp({ db, basePath: '/' })).get('/api/health')
    expect(response.status).toBe(503)
    expect(Date.now() - start).toBeLessThan(5000)
  }, 10_000)
})

describe('API errors', () => {
  it.each(['get', 'post', 'put', 'patch', 'delete', 'options'] as const)(
    'answers %s to an unknown path with 404 JSON',
    async (method) => {
      const app = await createTestApp()
      for (const path of ['/api', '/api/', '/api/nope', '/api/nope/deeper', '/%61pi/nope', '//api/nope']) {
        if (method !== 'get' && !path.startsWith('/api')) continue
        const response = await request(app)[method](path)
        expect(response.status, path).toBe(404)
        expect(response.type, path).toBe('application/json')
        expect(response.body, path).toEqual(notFound)
        expect(response.headers).not.toHaveProperty('x-powered-by')
      }
    },
  )

  describe.each(['development', 'production'])('in %s', (nodeEnv) => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', nodeEnv)
      return () => vi.unstubAllEnvs()
    })

    const app = () =>
      createApp({
        db: database.db,
        basePath: '/',
        extend: (api) => {
          api.post('/echo', (req, res) => res.json(req.body))
          api.get('/throw', () => {
            throw new Error('boom')
          })
          api.get('/reject', () => Promise.reject(new Error('boom')))
          for (const status of [400, 401, 404, 413, 429, 503]) {
            const error = () => new AdapterError('boom', status)
            api.get(`/adapter/${status}`, () => Promise.reject(error()))
            api.post(`/adapter/${status}`, (_req, _res, next) => next(error()))
          }
          api.get('/missing-file', (_req, res) => res.sendFile('/boom/no-such-file'))
          const notErrors = { null: null, undefined, route: 'route', router: 'router' }
          for (const [name, value] of Object.entries<unknown>(notErrors)) {
            api.get(`/throw/${name}`, () => {
              throw value
            })
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            api.get(`/reject/${name}`, () => Promise.reject(value))
          }
          const nothing: unknown = null
          const nested = Router()
          nested.use('/middleware', () => {
            throw nothing
          })
          nested.route('/route').get(() => {
            throw nothing
          })
          api.use('/nested', nested)
          api.get('/skip', (_req, _res, next) => next('route'))
          api.get('/things/:id', (req, res) => res.json(req.params.id))
        },
      })

    it.each(['/api/throw', '/api/reject'])('hides an unexpected exception from %s', async (path) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const response = await request(app()).get(path)
      expect(response.status).toBe(500)
      expect(response.body).toEqual({ error: { code: 'internal_error', message: 'Something went wrong' } })
      expect(response.text).not.toContain('boom')
      expect(log).toHaveBeenCalledOnce()
    })

    async function expectInternalError(test: request.Test) {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const response = await test
      expect(response.status).toBe(500)
      expect(response.body).toEqual({ error: { code: 'internal_error', message: 'Something went wrong' } })
      expect(log).toHaveBeenCalledOnce()
    }

    it.each([400, 401, 404, 413, 429, 503])(
      'does not pass on the status %i of an unexpected exception',
      async (status) => {
        await expectInternalError(request(app()).get(`/api/adapter/${status}`))
        vi.restoreAllMocks()
        await expectInternalError(request(app()).post(`/api/adapter/${status}`).send({ a: 1 }))
      },
    )

    it('treats a missing file in a route as unexpected', async () => {
      await expectInternalError(request(app()).get('/api/missing-file'))
    })

    it.each([
      ...['null', 'undefined', 'route', 'router'].flatMap((name) => [`throw/${name}`, `reject/${name}`]),
      'nested/middleware',
      'nested/route',
    ])('treats a thrown value that is not an error as unexpected: %s', async (path) => {
      await expectInternalError(request(app()).get(`/api/${path}`))
    })

    it('still lets a route pass a request on', async () => {
      const response = await request(app()).get('/api/skip')
      expect(response.status).toBe(404)
      expect(response.body).toEqual(notFound)
    })

    it('answers requests that cannot be read with 4xx, unlogged', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const unreadable: [number, request.Test][] = [
        [400, request(app()).get('/api/things/%ff')],
        [415, request(app()).post('/api/echo').set('Content-Type', 'application/json; charset=nope').send('{}')],
        [415, request(app()).post('/api/echo').type('json').set('Content-Encoding', 'nope').send('{}')],
        [400, request(app()).post('/api/echo').type('json').set('Content-Encoding', 'gzip').send('{}')],
      ]
      for (const [status, test] of unreadable) {
        const response = await test
        expect(response.status).toBe(status)
        expect(response.body).toHaveProperty('error.code', 'bad_request')
      }
      expect(log).not.toHaveBeenCalled()
    })

    it('answers malformed JSON with 400', async () => {
      const response = await request(app()).post('/api/echo').type('json').send('{"a":')
      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        error: { code: 'bad_request', message: 'The request could not be read' },
      })
    })
  })

  it('accepts well-formed JSON and refuses a body that is too large', async () => {
    const app = createApp({
      db: database.db,
      basePath: '/',
      extend: (api) => api.post('/echo', (req, res) => res.json(req.body)),
    })
    expect((await request(app).post('/api/echo').send({ a: 1 })).body).toEqual({ a: 1 })
    const response = await request(app).post('/api/echo').send({ a: 'x'.repeat(200_000) })
    expect(response.status).toBe(413)
    expect(response.body).toHaveProperty('error.code', 'payload_too_large')
  })
})

describe.each([
  ['/', ''],
  ['/jettime/', '/jettime'],
])('web app at %s', (basePath, prefix) => {
  it.each(['/', '/time', '/nope/deeper', '/nope/deeper/still/', '/apiary', '/projects/12.5', '/package.json'])(
    'answers page %s with index.html for the base path',
    async (path) => {
      const response = await request(await createTestApp(basePath)).get(prefix + path)
      expect(response.status).toBe(200)
      expect(response.type).toBe('text/html')
      expect(response.text).toContain(`<meta name="base-path" content="${basePath}" />`)
      expect(response.text).toContain(`<script src="${basePath}assets/app.js">`)
      expect(response.headers).not.toHaveProperty('x-powered-by')
    },
  )

  it('serves files, with long caching for hashed assets only', async () => {
    const app = await createTestApp(basePath)
    const asset = await request(app).get(`${prefix}/assets/app.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers['cache-control']).toContain('immutable')
    const icon = await request(app).get(`${prefix}/favicon.svg`)
    expect(icon.status).toBe(200)
    expect(icon.headers['cache-control']).not.toContain('immutable')
    const page = await request(app).get(`${prefix}/`)
    expect(page.headers['cache-control']).toBe('no-cache')
    expect((await request(app).get(`${prefix}/index.html`)).headers.location).toBe(basePath)
    const range = await request(app).get(`${prefix}/assets/app.js`).set('Range', 'bytes=900-')
    expect(range.status).toBe(416)
  })

  it.each(['/assets/missing.js', '/assets', '/assets/', '/%61ssets/missing.js', '/.env', '/%E0%A4%A'])(
    'answers %s with 404, not HTML',
    async (path) => {
      const response = await request(await createTestApp(basePath)).get(prefix + path)
      expect(response.status).toBe(404)
      expect(response.type).not.toBe('text/html')
    },
  )

  it('does not answer other methods with the web app', async () => {
    expect((await request(await createTestApp(basePath)).post(`${prefix}/time`)).status).toBe(404)
  })

  it('never serves files outside the web build', async () => {
    const app = await createTestApp(basePath)
    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      for (const path of [
        '/../package.json',
        '/..%2fpackage.json',
        '/%2e%2e/package.json',
        '/..%5cpackage.json',
        '/assets/../../package.json',
        '/assets/..%2f..%2fpackage.json',
        '/.env',
      ]) {
        // A plain request: other clients tidy up the path before sending it.
        const body = await new Promise<string>((resolve, reject) => {
          http
            .get({ host: '127.0.0.1', port, path: prefix + path, agent: false }, (res) => {
              let text = ''
              res.on('data', (chunk: Buffer) => (text += chunk.toString()))
              res.on('end', () => resolve(text))
            })
            .on('error', reject)
        })
        expect(body, path).not.toMatch(/outside|secret/)
      }
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('answers the API under the base path', async () => {
    const app = await createTestApp(basePath)
    expect((await request(app).get(`${prefix}/api/health`)).status).toBe(200)
    expect((await request(app).get(`${prefix}/api/nope`)).body).toEqual(notFound)
  })
})

describe('with a base path', () => {
  it('redirects the path without a slash, keeping the query', async () => {
    const app = await createTestApp('/jettime/')
    expect((await request(app).get('/jettime')).headers.location).toBe('/jettime/')
    expect((await request(app).get('/jettime?a=1?b')).headers.location).toBe('/jettime/?a=1?b')
  })

  it.each(['/', '/api/health', '/time', '/favicon.svg', '/jettime2/', '/JETTIME/', '/jettime2/api/health'])(
    'answers %s, outside the prefix, with 404',
    async (path) => {
      expect((await request(await createTestApp('/jettime/')).get(path)).status).toBe(404)
    },
  )
})

it('says so when the web app has not been built', async () => {
  const webDir = await createTempDir()
  expect(() => createApp({ db: database.db, basePath: '/', webDir })).toThrow('npm run build')
})
