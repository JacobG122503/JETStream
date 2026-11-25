import express, { type Express, type RequestHandler } from 'express'
import { type ApiOptions, createApiRouter, handleApiError } from './api/router'
import type { AppContext } from './context'
import type { Db } from './db'
import { captureSender, type EmailSender } from './email/sender'
import { securityHeaders } from './headers'
import { type PaymentProvider, simulatedPayments } from './payments/provider'
import { createWebRouter } from './web'

export interface AppOptions extends ApiOptions {
  db: Db
  /** Starts and ends with "/". */
  basePath: string
  /** Folder of the built web app. Left out in development, where Vite serves it. */
  webDir?: string
  /** The address people use, ending with the base path. */
  publicUrl?: string
  /** Number of reverse proxies in front. */
  trustProxy?: number
  mode?: 'development' | 'demo' | 'production'
  now?: () => Date
  email?: EmailSender
  payments?: PaymentProvider
}

export function createContext(options: AppOptions): AppContext {
  const { db, basePath, mode = 'production' } = options
  return {
    db,
    basePath,
    publicUrl: options.publicUrl ?? `http://localhost${basePath}`,
    acceptHostOrigin: mode !== 'production',
    demo: mode === 'demo',
    now: options.now ?? (() => new Date()),
    email: options.email ?? captureSender(db),
    payments: options.payments ?? (mode === 'production' ? null : simulatedPayments),
  }
}

export function createApp(options: AppOptions): Express {
  const { basePath, webDir, trustProxy = 0, extend } = options
  const app = express()
  app.disable('x-powered-by')
  app.enable('case sensitive routing')
  app.set('trust proxy', trustProxy)
  app.use(securityHeaders)

  const mount = basePath.replace(/\/$/, '')
  app.use(mount || '/', redirectToSlash(basePath))
  app.use(`${mount}/api`, createApiRouter(createContext(options), { extend }))
  if (webDir !== undefined) app.use(mount || '/', createWebRouter(webDir, basePath))
  app.use((_req, res) => {
    res.status(404).type('text').send('Not found')
  })
  app.use(handleApiError)
  return app
}

/** /jetstream -> /jetstream/, so relative addresses on the page resolve inside the prefix. */
function redirectToSlash(basePath: string): RequestHandler {
  return (req, res, next) => {
    const [path = '', query] = req.originalUrl.split(/\?(.*)/s)
    if (`${path}/` === basePath && (req.method === 'GET' || req.method === 'HEAD')) {
      res.redirect(query === undefined ? basePath : `${basePath}?${query}`)
    } else {
      next()
    }
  }
}
