import { Router } from 'express'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiRouter } from '../api/router'
import { jsonBody } from '../api/body'
import { createContext } from '../app'
import type { Database } from '../db'
import { companySettings, people, sessions } from '../db/schema'
import { accounts, browser, type Browser, signedIn, testApp } from '../testing/apiClient'
import { createTestDatabase } from '../testing/testDatabase'
import { createAccess, declaredRoutes } from './access'

let database: Database
let account: ReturnType<typeof accounts>
beforeAll(async () => {
  database = await createTestDatabase()
  account = accounts(database.db)
})
afterAll(() => database.close())

const errorCode = (response: { body: unknown }) => (response.body as { error?: { code: string } }).error?.code

type Method = 'get' | 'post' | 'put' | 'delete'
const routesIn = (mode: 'production' | 'demo') =>
  declaredRoutes(createApiRouter(createContext({ db: database.db, basePath: '/', mode })))

const call = (client: Browser, { method, path }: { method: string; path: string }) =>
  client.send(method as Method, path.replace(':id', '1'), method === 'get' ? undefined : {})

describe('access levels', () => {
  it('are declared by every route, and only the known ones are public', () => {
    const routes = routesIn('demo')
    expect(routes.filter(({ level }) => level === 'public').map(({ method, path }) => `${method} ${path}`).sort()).toEqual([
      'get /health', 'get /session', 'post /forgot-password', 'post /invite/accept', 'post /invite/check',
      'post /reset-password/check', 'post /reset-password/use', 'post /session/demo', 'post /session/sign-in',
      'post /session/sign-out', 'post /sign-up',
    ])
    expect(routes.filter(({ level }) => level === 'signedIn').length).toBeGreaterThan(5)
    expect(routes.filter(({ level }) => level === 'administrator').length).toBeGreaterThan(10)
    expect(routesIn('production').map(({ path }) => path)).not.toContain('/session/demo')
  })

  it('are required: a route without one is an error', () => {
    const context = createContext({ db: database.db, basePath: '/' })
    const build = (extend: (api: Router) => void) => () => createApiRouter(context, { extend })
    expect(build((api) => api.get('/open', (_req, res) => res.json({})))).toThrow('GET /open has no access level')
    expect(build((api) => api.use('/sub', Router().post('/open', (_req, res) => res.json({}))))).toThrow('POST /open')
    const access = createAccess(context)
    expect(
      build((api) => {
        // One method of a route has it, the other not.
        const route = api.route('/half')
        route.get(access.public, (_req, res) => res.json({}))
        route.post((_req, res) => res.json({}))
      }),
    ).toThrow('POST /half')
    expect(build((api) => api.get('/late', (_req, _res, next) => next(), access.signedIn))).toThrow('GET /late')
    expect(build((api) => api.all('/every', (_req, res) => res.json({})))).toThrow('/every')
  })

  it('refuse everything that is not public without a session', async () => {
    const app = testApp({ db: database.db })
    for (const route of routesIn('production').filter(({ level }) => level !== 'public')) {
      const response = await call(browser(app), route)
      expect([response.status, errorCode(response)], `${route.method} ${route.path}`).toEqual([401, 'unauthenticated'])
    }
  })

  it('refuse administrator routes to a member and a manager', async () => {
    const app = testApp({ db: database.db })
    for (const role of ['member', 'manager'] as const) {
      const client = await signedIn(app, (await account(role)).email)
      for (const route of routesIn('production').filter(({ level }) => level === 'administrator')) {
        const response = await call(client, route)
        expect([response.status, errorCode(response)], `${route.method} ${route.path}`).toEqual([403, 'forbidden'])
      }
    }
  })

  it('refuse a pending person everything but the session and signing out', async () => {
    const app = testApp({ db: database.db })
    const client = await signedIn(app, (await account('administrator', { status: 'pending' })).email)
    for (const route of routesIn('production').filter(({ level }) => level !== 'public')) {
      const response = await call(client, route)
      expect([response.status, errorCode(response)], `${route.method} ${route.path}`).toEqual([403, 'pending_approval'])
    }
    expect((await client.get('/session')).body).toMatchObject({ person: { status: 'pending' } })
    expect((await client.post('/session/sign-out')).status).toBe(200)
  })

  it('leave unknown paths not found, signed in or not', async () => {
    const app = testApp({ db: database.db })
    const client = await signedIn(app, (await account()).email)
    client.csrfToken = undefined
    for (const answer of [await client.post('/nope'), await client.get('/nope'), await browser(app).post('/people/1/nope')]) {
      expect([answer.status, answer.body]).toEqual([404, { error: { code: 'not_found', message: 'Not found' } }])
    }
  })
})

describe('requests from elsewhere', () => {
  const profile = { name: 'Changed', timeZone: 'UTC', version: 1 }
  const nameOf = async (id: number) => (await database.db.select().from(people).where(eq(people.id, id)))[0]?.name

  it('are refused without the token of this very session, and change nothing', async () => {
    const app = testApp({ db: database.db })
    const person = await account('member', { name: 'Unchanged' })
    const client = await signedIn(app, person.email)
    const other = await signedIn(app, person.email)
    const good = client.csrfToken ?? ''
    for (const token of [undefined, '', 'x', other.csrfToken, `${good}x`, good.toLowerCase() === good ? 'y' : good.toLowerCase()]) {
      client.csrfToken = token
      const response = await client.put('/account/profile', profile)
      expect([response.status, errorCode(response)], String(token)).toEqual([403, 'csrf'])
    }
    expect(await nameOf(person.id)).toBe('Unchanged')
    for (const path of ['/session/sign-in', '/session/sign-out', '/sign-up', '/forgot-password', '/invite/check']) {
      expect(errorCode(await client.post(path)), path).toBe('csrf')
    }
    client.csrfToken = good
    expect((await client.get('/account')).status).toBe(200)
    expect((await client.put('/account/profile', profile)).status).toBe(200)
  })

  const sent = async (headers: Record<string, string>, options: Partial<Parameters<typeof testApp>[0]> = {}) => {
    const app = testApp({ db: database.db, publicUrl: 'https://time.example.com/', ...options })
    return request(app).post('/api/session/sign-out').set(headers)
  }

  it.each(['https://evil.example', 'http://time.example.com', 'https://time.example.com:8443', 'null', 'https://time.example.com.evil.example'])(
    'are refused from origin %s, also before sign-in',
    async (origin) => {
      const response = await sent({ Origin: origin })
      expect([response.status, errorCode(response)]).toEqual([403, 'csrf'])
    },
  )

  it('are accepted from the public address, and without an origin', async () => {
    expect((await sent({ Origin: 'https://time.example.com' })).status).toBe(200)
    expect((await sent({})).status).toBe(200)
    expect((await request(testApp({ db: database.db })).get('/api/session').set('Origin', 'https://evil.example')).status).toBe(200)
  })

  it('are accepted from the address they were sent to only in development and demo', async () => {
    const headers = { Host: 'localhost:3456', Origin: 'http://localhost:3456' }
    expect((await sent(headers)).status).toBe(403)
    for (const mode of ['development', 'demo'] as const) {
      expect((await sent(headers, { mode })).status).toBe(200)
      expect((await sent({ ...headers, Origin: 'http://localhost:9999' }, { mode })).status).toBe(403)
      expect((await sent({ ...headers, Origin: 'http://evil.example' }, { mode })).status).toBe(403)
    }
  })

  it('must be JSON where JSON is expected', async () => {
    const app = testApp({ db: database.db })
    const person = await account()
    const client = await signedIn(app, person.email)
    const form = await client.send('post', '/account/password', undefined, { 'Content-Type': 'text/plain', 'Content-Length': '0' })
    expect([form.status, errorCode(form)]).toEqual([415, 'unsupported_media_type'])
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/jsonx']) {
      const response = await request(app).post('/api/session/sign-in').set('Content-Type', type).send('{"email":"a@b.example"}')
      expect(response.status, type).toBe(415)
    }
    expect((await request(app).post('/api/session/sign-in').set('Content-Type', 'application/json; charset=utf-8').send('{}')).status).toBe(400)
    expect((await request(app).post('/api/session/sign-in')).status).toBe(400)
  })

  it('cannot change anything with GET or HEAD', async () => {
    const app = testApp({ db: database.db })
    const client = await signedIn(app, (await account('administrator')).email)
    const snapshot = async () =>
      JSON.stringify([await database.db.select().from(people).orderBy(people.id), await database.db.select().from(companySettings), (await database.db.select().from(sessions)).length])
    const before = await snapshot()
    for (const { path } of routesIn('production').filter(({ method }) => method === 'get')) {
      await client.send('get', path.replace(':id', '1'))
      await client.send('head', path.replace(':id', '1'))
    }
    expect(await snapshot()).toBe(before)
  })
})

it('reads no body from someone who may not use the route', async () => {
  let read = false
  const app = testApp({
    db: database.db,
    extend: (api, access) => {
      api.post('/private', access.signedIn, (req, _res, next) => {
        read = true
        next()
      }, jsonBody, (_req, res) => res.json({}))
    },
  })
  expect((await request(app).post('/api/private').send('{"a":')).status).toBe(401)
  expect(read).toBe(false)
})
