import express, { type Express, type RequestHandler } from 'express'
import { type ApiOptions, createApiRouter, handleApiError } from './api/router'
import { createWebRouter } from './web'

export interface AppOptions extends ApiOptions {
  /** Starts and ends with "/". */
  basePath: string
  /** Folder of the built web app. Left out in development, where Vite serves it. */
  webDir?: string
}

export function createApp({ basePath, webDir, ...apiOptions }: AppOptions): Express {
  const app = express()
  app.disable('x-powered-by')
  app.enable('case sensitive routing')

  const mount = basePath.replace(/\/$/, '')
  app.use(mount || '/', redirectToSlash(basePath))
  app.use(`${mount}/api`, createApiRouter(apiOptions))
  if (webDir !== undefined) app.use(mount || '/', createWebRouter(webDir, basePath))
  app.use((_req, res) => {
    res.status(404).type('text').send('Not found')
  })
  app.use(handleApiError)
  return app
}

/** /jettime -> /jettime/, so relative addresses on the page resolve inside the prefix. */
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
