import { expect, it } from 'vitest'
import { homePath, safeReturnPath, signInPath } from './returnPath'

it.each([
  '//evil.example', '/\\evil.example', '\\\\evil.example', 'https://evil.example', 'javascript:alert(1)', 'evil.example', '', '/\n/evil.example',
  '/\t/evil.example', '\n//evil.example', '/%0a/evil', '/%0D%0Ax', '/%00', '/%5Cevil.example', '/x/..//evil.example', '/.//evil.example',
  '/%', '/%zz', ' /time', '/a b', '/sign-in', '/Sign-In/?next=/x', '/invite', '/reset-password', `/${'x'.repeat(3000)}`, null,
])('leads to the home page for %j', (value) => {
  expect(safeReturnPath(value)).toEqual(homePath)
})

it.each([
  ['/reports?x=1', { pathname: '/reports', search: '?x=1', hash: '' }],
  ['/team/12?tab=a%0ab#part', { pathname: '/team/12', search: '?tab=a%0ab', hash: '#part' }],
  ['/time/', { pathname: '/time/', search: '', hash: '' }],
  ['/caf%C3%A9', { pathname: '/caf%C3%A9', search: '', hash: '' }],
  ['/reports?next=https://evil.example', { pathname: '/reports', search: '?next=https://evil.example', hash: '' }],
])('keeps %s', (value, expected) => {
  expect(safeReturnPath(value)).toEqual(expected)
})

it('makes an address that leads back', () => {
  const path = { pathname: '/reports', search: '?x=1&y=a%20b', hash: '#z' }
  const { pathname, search } = signInPath(path)
  expect(pathname).toBe('/sign-in')
  expect(safeReturnPath(new URLSearchParams(search).get('next'))).toEqual(path)
  expect(signInPath(homePath)).toEqual({ pathname: '/sign-in', search: '' })
})
