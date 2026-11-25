/** Where to go after signing in. The address comes from the page's own address, so anyone can make one up. */

export interface AppPath {
  pathname: string
  search: string
  hash: string
}

export const homePath: AppPath = { pathname: '/', search: '', hash: '' }

/** Pages that are there before signing in: returning to them makes no sense. */
export const signedOutPaths = ['/sign-in', '/sign-up', '/forgot-password', '/invite', '/reset-password']

// eslint-disable-next-line no-control-regex -- control characters are what it is about
const controlCharacters = /[\u0000-\u0020\u007f-\u009f\\]/
const encodedControlCharacters = /%(?:[01][0-9a-f]|7f|5c)/i

/** The path inside the app, taken apart; the home page for everything that is not plainly one. */
export function safeReturnPath(value: string | null): AppPath {
  if (value === null || value.length > 2000 || !/^\/(?!\/)/.test(value) || controlCharacters.test(value)) return homePath
  let url: URL
  try {
    url = new URL(value, 'http://app.invalid')
    decodeURIComponent(url.pathname)
  } catch {
    return homePath
  }
  const { origin, pathname, search, hash } = url
  // Once more, because dot segments are gone now.
  if (origin !== 'http://app.invalid' || pathname.startsWith('//') || encodedControlCharacters.test(pathname)) return homePath
  if (signedOutPaths.includes(pathname.toLowerCase().replace(/\/$/, ''))) return homePath
  return { pathname, search, hash }
}

/** The sign-in page that leads back to this path. */
export function signInPath({ pathname, search, hash }: AppPath): { pathname: string; search: string } {
  const path = pathname + search + hash
  return { pathname: '/sign-in', search: pathname === '/' ? '' : `?next=${encodeURIComponent(path)}` }
}
