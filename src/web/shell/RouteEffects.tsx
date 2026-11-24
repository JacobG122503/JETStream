import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { focusPageHeading } from '../ui/overlay/focus'

/** Around all pages: moves focus and scrolling to the top of a page that is navigated to. */
export function RouteEffects() {
  const { pathname } = useLocation()
  const shown = useRef<string>()

  useEffect(() => {
    // Otherwise the browser scrolls back by itself on Back and Forward.
    history.scrollRestoration = 'manual'
  }, [])

  useEffect(() => {
    // "/" only leads on to another page.
    if (pathname === '/' || pathname === shown.current) return
    const first = shown.current === undefined
    shown.current = pathname
    // Not on the first page: there, focus begins at the skip link.
    if (first) return
    window.scrollTo(0, 0)
    focusPageHeading()
  }, [pathname])

  return <Outlet />
}
