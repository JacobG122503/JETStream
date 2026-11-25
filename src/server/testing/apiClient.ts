import type { Express } from 'express'
import request from 'supertest'
import type { SessionInfo } from '../../shared/api'
import { createApp, type AppOptions } from '../app'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { people, personCredentials, roles } from '../db/schema'
import type { EmailMessage, EmailSender } from '../email/sender'
import { messageText } from '../email/sender'
import { hashPassword } from '../security/passwords'
import { makeRecords } from './records'

type Method = 'get' | 'post' | 'put' | 'delete' | 'head'

/** A browser: keeps the session cookie, and sends the token that belongs to it. */
export function browser(app: Express, prefix = '') {
  const client = {
    cookie: undefined as string | undefined,
    csrfToken: undefined as string | undefined,
    headers: {} as Record<string, string>,
    /** The last Set-Cookie header. */
    setCookie: undefined as string | undefined,
    async send(method: Method, path: string, body?: object, headers: Record<string, string> = {}) {
      const test = request(app)[method](`${prefix}/api${path}`)
      if (client.cookie) test.set('Cookie', client.cookie)
      if (client.csrfToken && method !== 'get') test.set('X-CSRF-Token', client.csrfToken)
      for (const [name, value] of Object.entries({ ...client.headers, ...headers })) test.set(name, value)
      const response = body === undefined ? await test : await test.send(body)
      const set = response.get('Set-Cookie')?.[0]
      if (set !== undefined) {
        client.setCookie = set
        const value = set.split(';')[0] ?? ''
        client.cookie = value.endsWith('=') ? undefined : value
      }
      const info = response.body as Partial<SessionInfo> | undefined
      if (info?.csrfToken) client.csrfToken = info.csrfToken
      return response
    },
    get: (path: string) => client.send('get', path),
    post: (path: string, body: object = {}, headers?: Record<string, string>) => client.send('post', path, body, headers),
    put: (path: string, body: object) => client.send('put', path, body),
    delete: (path: string) => client.send('delete', path),
    signIn: (email: string, password: string, keep = false) => client.post('/session/sign-in', { email, password, keep }),
  }
  return client
}

export type Browser = ReturnType<typeof browser>

/** Keeps messages, as an adapter that delivers them would. */
export function standInSender() {
  const messages: (EmailMessage & { text: string })[] = []
  const sender: EmailSender = {
    delivers: true,
    send: (message) => {
      messages.push({ ...message, text: messageText(message) })
      return Promise.resolve()
    },
  }
  return { sender, messages }
}

/** A clock that stands still until it is moved. */
export function testClock(start = '2026-03-02T15:00:00Z') {
  let at = Date.parse(start)
  return {
    now: () => new Date(at),
    forward: (minutes: number) => {
      at += minutes * 60_000
    },
  }
}

export const goodPassword = 'correct horse battery'
let goodHash: Promise<string> | undefined

/** People who can sign in with `goodPassword`. Hashed once, because hashing is slow on purpose. */
export function accounts(db: Db) {
  const make = makeRecords(db)
  return async (role: 'administrator' | 'manager' | 'member' = 'member', values: Partial<typeof people.$inferInsert> = {}) => {
    goodHash ??= hashPassword(goodPassword)
    const [{ id: roleId } = { id: 0 }] = await db.select().from(roles).where(eq(roles.key, role))
    const person = await make.person({ roleId, ...values })
    await db.insert(personCredentials).values({ personId: person.id, passwordHash: await goodHash })
    return person
  }
}

export function testApp(options: Omit<AppOptions, 'basePath'> & { basePath?: string }) {
  return createApp({ basePath: '/', ...options })
}

/** A signed-in browser. */
export async function signedIn(app: Express, email: string, password = goodPassword, prefix = ''): Promise<Browser> {
  const client = browser(app, prefix)
  const response = await client.signIn(email, password)
  if (response.status !== 200) throw new Error(`Sign-in failed with ${response.status}: ${response.text}`)
  return client
}
