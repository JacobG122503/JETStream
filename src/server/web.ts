import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import express, { type ErrorRequestHandler, type RequestHandler, Router } from 'express'
import { ApiError, clientError, errorCode, StartupError } from './errors'

/**
 * The build refers to its files as "./name". Making those absolute for the base path lets one
 * build run under any prefix and at any page depth. The base-path <meta> tag uses the same form.
 */
export function renderIndexHtml(template: string, basePath: string): string {
  return template.replaceAll('="./', `="${basePath}`)
}

function readIndexHtml(webDir: string): string {
  try {
    return readFileSync(join(webDir, 'index.html'), 'utf8')
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
    throw new StartupError('The web app has not been built. Run npm run build first.')
  }
}

const notFound: RequestHandler = (_req, res) => {
  res.status(404).type('text').send('Not found')
}

// express.static refuses some requests, for example for a part of a file that does not exist.
const refuseRequest: ErrorRequestHandler = (error: unknown, _req, _res, next) => {
  next(clientError(error) ?? error)
}

/** Serves the built web app: its files, and index.html for every page address. */
export function createWebRouter(webDir: string, basePath: string): Router {
  const html = renderIndexHtml(readIndexHtml(webDir), basePath)
  const web = Router({ caseSensitive: true })
  const staticOptions = { index: false, redirect: false } as const

  web.get('/index.html', (_req, res) => res.redirect(basePath))
  // File names under assets contain a content hash, so they never change.
  web.use('/assets', express.static(join(webDir, 'assets'), { ...staticOptions, immutable: true, maxAge: '1y' }))
  web.use(express.static(webDir, staticOptions))
  web.get(/.*/, (req, res, next) => {
    const path = normalisePath(req.path)
    if (isUnder(path, '/api')) throw new ApiError(404, 'not_found', 'Not found')
    if (path === undefined || isUnder(path, '/assets') || /\/\./.test(path)) {
      next()
      return
    }
    res.set('Cache-Control', 'no-cache').type('html').send(html)
  })
  web.use(notFound)
  web.use(refuseRequest)
  return web
}

/** Undoes percent-encoding and dot segments, so a disguised path gets the same answer. */
function normalisePath(path: string): string | undefined {
  try {
    return posix.normalize(decodeURIComponent(path).replaceAll('\\', '/'))
  } catch {
    return undefined
  }
}

function isUnder(path: string | undefined, prefix: string): boolean {
  return path === prefix || (path?.startsWith(`${prefix}/`) ?? false)
}
