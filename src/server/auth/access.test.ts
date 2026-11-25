import { join } from 'node:path'
import { ESLint } from 'eslint'
import { Router } from 'express'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Grants, permissionCatalogue, permissionOf, type PermissionKey, writeGrants } from '../../shared/permissions'
import { createApiRouter } from '../api/router'
import { jsonBody } from '../api/body'
import { createContext } from '../app'
import type { Database } from '../db'
import { companySettings, people, roles, sessions } from '../db/schema'
import { projectRoot } from '../paths'
import { accounts, browser, type Browser, signedIn, testApp } from '../testing/apiClient'
import { makeRecords } from '../testing/records'
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
      'get /health', 'get /logo', 'get /session', 'post /forgot-password', 'post /invite/accept', 'post /invite/check',
      'post /reset-password/check', 'post /reset-password/use', 'post /session/demo', 'post /session/sign-in',
      'post /session/sign-out', 'post /sign-up',
    ])
    expect(routes.filter(({ level }) => level === 'signedIn').length).toBeGreaterThan(5)
    expect(routes.filter(({ level }) => level === 'permission').length).toBeGreaterThan(15)
    for (const { permission } of routes) if (permission !== undefined) expect(permissionOf(permission)).toBeDefined()
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

  it('refuse administrator routes to everyone else, also with every permission at all', async () => {
    const app = testApp({ db: database.db, extend: (api, access) => api.get('/backup', access.administrator, (_req, res) => res.json({})) })
    const every = Object.fromEntries(permissionCatalogue.map(({ key }) => [key, 'all'])) as Grants
    for (const role of ['member', 'manager', every] as const) {
      const response = await (await signedIn(app, (await account(role)).email)).get('/backup')
      expect([response.status, errorCode(response)]).toEqual([403, 'forbidden'])
    }
    expect((await (await signedIn(app, (await account('administrator')).email)).get('/backup')).status).toBe(200)
  })

  it('refuse a permission route without the permission, before anything is read, and not with just that', { timeout: 60_000 }, async () => {
    const app = testApp({ db: database.db })
    const make = makeRecords(database.db)
    const routes = routesIn('production').filter(({ level }) => level === 'permission')
    const keys = new Set(routes.map(({ permission }) => permission as PermissionKey))
    const without = await signedIn(app, (await account('member')).email)
    // Somebody whom everybody outranks, and a role that gives nothing.
    const target = (await account('member')).id
    const role = (await make.role()).id
    const send = (client: Browser, { method, path }: { method: string; path: string }) =>
      client.send(method as Method, path.replace(':id', String(path.startsWith('/roles') ? role : target)), method === 'get' ? undefined : {})
    for (const key of keys) {
      // Every other permission is no help.
      const others = permissionCatalogue.filter((other) => other.key !== key && !other.needs.includes(key)).map((other) => [other.key, 'all'])
      const allOthers = await signedIn(app, (await account(Object.fromEntries(others) as Grants)).email)
      const only = { [key]: 'all', ...Object.fromEntries(permissionOf(key).needs.map((need) => [need, 'all'])) } as Grants
      const holder = await signedIn(app, (await account(only)).email)
      for (const route of routes.filter(({ permission, orOwner }) => permission === key && !orOwner)) {
        const name = `${route.method} ${route.path}`
        for (const client of [without, allOthers]) {
          const response = await send(client, route)
          expect([response.status, errorCode(response)], name).toEqual([403, 'forbidden'])
        }
        expect((await send(holder, route)).status, `${name} with ${key}`).not.toBe(403)
      }
    }
    // A body that cannot be read at all is no different.
    const broken = await without.send('post', '/roles', { name: 7 })
    expect(broken.status).toBe(403)
  })

  it('know only permissions of the catalogue', () => {
    const context = createContext({ db: database.db, basePath: '/' })
    const build = () =>
      createApiRouter(context, { extend: (api, access) => api.get('/fly', access.permission('time.fly' as PermissionKey), (_req, res) => res.json({})) })
    expect(build).toThrow('time.fly')
  })

  it('of permission routes can let people through to what is their own', async () => {
    const app = testApp({
      db: database.db,
      extend: (api, access) => {
        api.get('/own', access.permission('time.view', { orOwner: true }), (_req, res) => res.json({}))
        api.get('/others', access.permission('time.view'), (_req, res) => res.json({}))
      },
    })
    const member = await signedIn(app, (await account('member')).email)
    expect([(await member.get('/own')).status, (await member.get('/others')).status]).toEqual([200, 403])
  })

  it('cannot be checked in param callbacks: a router with one is an error', () => {
    const context = createContext({ db: database.db, basePath: '/' })
    expect(() => createApiRouter(context, { extend: (api) => api.param('id', (_req, _res, next) => next()) })).toThrow('parameter id')
    const inner = Router()
    inner.param('personId', (_req, _res, next) => next())
    expect(() => createApiRouter(context, { extend: (api) => api.use('/sub', inner) })).toThrow('parameter personId')
  })

  it('are judged by the database at each request', async () => {
    const app = testApp({ db: database.db })
    const make = makeRecords(database.db)
    const person = await account({ 'roles.manage': 'all', 'people.view': 'all' })
    const client = await signedIn(app, person.email)
    const status = async () => (await client.get('/roles')).status
    const [own] = await database.db.select().from(people).where(eq(people.id, person.id))
    expect(await status()).toBe(200)
    await database.db.update(roles).set({ permissions: writeGrants({ 'people.view': 'all' }) }).where(eq(roles.id, own?.roleId ?? 0))
    expect(await status()).toBe(403)
    const manager = await make.builtInRole('manager')
    await database.db.update(people).set({ roleId: manager.id }).where(eq(people.id, person.id))
    const other = await make.person()
    const listed = async () => ((await client.get('/people')).body as { people: { id: number }[] }).people.map(({ id }) => id)
    expect(await listed()).toEqual([])
    await make.manages(person.id, other.id)
    expect(await listed()).toEqual([other.id])
    await database.db.update(people).set({ status: 'pending' }).where(eq(people.id, person.id))
    expect(await status()).toBe(403)
    await database.db.update(people).set({ status: 'archived' }).where(eq(people.id, person.id))
    expect(await status()).toBe(401)
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

describe('lint', () => {
  const problems = async (file: string, code: string) => {
    const [result] = await new ESLint({ cwd: projectRoot }).lintText(code, { filePath: join(projectRoot, file) })
    return (result?.messages ?? []).filter(({ ruleId }) => ruleId?.startsWith('no-restricted')).length
  }

  it('keeps tables and the data layer out of routes', { timeout: 60_000 }, async () => {
    const route = 'src/server/api/routes/people.ts'
    for (const code of [
      "import { people } from '../../db/schema'\nvoid people\n", "import { runTransaction } from '../../db'\nvoid runTransaction\n",
      "import { eq } from 'drizzle-orm'\nvoid eq\n", "import type { Db } from '../../db/database'\nexport type A = Db\n",
      "export { people } from '../../db/schema'\n", "void import('../../db/schema')\n",
      "import { systemActor } from '../../access/system'\nvoid systemActor\n",
    ]) {
      expect(await problems(route, code), code).toBe(1)
    }
    expect(await problems(route, "import { listPeople } from '../../people/people'\nvoid listPeople\n")).toBe(0)
    expect(await problems('src/server/api/health.ts', "import { sql } from 'drizzle-orm'\nvoid sql\n")).toBe(0)
  })
})
