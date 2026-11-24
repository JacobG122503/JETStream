import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'
import { canTakeFocus, focusPageHeading, tabbable } from './focus'
import { isTopLayer, layerExemptAttribute, pushLayer } from './layers'

interface ModalLayerOptions {
  /** Element that is a child of <body> and holds the layer. */
  rootRef: RefObject<HTMLElement>
  /** Element that focus is kept in. */
  panelRef: RefObject<HTMLElement>
  /** What gets focus on opening; the panel itself without it. */
  initialFocus?: () => HTMLElement | null | undefined
  onEscape: () => void
  /** Where focus goes when the element that had it before is gone; the page heading without it. */
  fallbackFocusRef?: RefObject<HTMLElement>
}

/** Call in a component that is mounted only while the layer is open. */
export function useModalLayer(options: ModalLayerOptions) {
  const latest = useRef(options)
  useLayoutEffect(() => {
    latest.current = options
  })

  useLayoutEffect(() => {
    const root = latest.current.rootRef.current
    const panel = latest.current.panelRef.current
    if (!root || !panel) return
    const opener = document.activeElement
    const removeLayer = pushLayer(root)
    const target = latest.current.initialFocus?.() ?? panel
    target.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopLayer(root)) return
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        latest.current.onEscape()
      } else if (event.key === 'Tab') {
        keepTabInside(event, panel)
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!isTopLayer(root) || !(event.target instanceof Element)) return
      if (root.contains(event.target) || event.target.closest(`[${layerExemptAttribute}]`)) return
      panel.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      const { fallbackFocusRef } = latest.current
      removeLayer()
      const restore = () => {
        const fallback = fallbackFocusRef?.current ?? null
        if (canTakeFocus(opener)) opener.focus({ preventScroll: true })
        else if (canTakeFocus(fallback)) fallback.focus({ preventScroll: true })
        else focusPageHeading()
      }
      restore()
      // The opener may go in the same update that closes the layer, such as a deleted row.
      setTimeout(() => {
        if (document.activeElement === null || document.activeElement === document.body) restore()
      })
    }
  }, [])
}

/** At either end, Tab goes on to the toasts (the only other thing in use) or to the other end. */
function keepTabInside(event: KeyboardEvent, panel: HTMLElement) {
  const inPanel = tabbable(panel)
  const inToasts = [...document.querySelectorAll(`[${layerExemptAttribute}]`)].flatMap(tabbable)
  const stops = [...inPanel, ...inToasts]
  if (stops.length === 0) {
    event.preventDefault()
    panel.focus()
    return
  }
  const { activeElement } = document
  const index = stops.indexOf(activeElement as HTMLElement)
  const last = stops.length - 1
  let next: HTMLElement | undefined
  if (index === -1) {
    // Focus is on the panel itself, or on something that Tab does not stop at.
    if (event.shiftKey && activeElement === panel) next = stops[last]
    else if (!panel.contains(activeElement)) next = event.shiftKey ? stops[last] : stops[0]
  } else if (event.shiftKey && index === 0) {
    next = stops[last]
  } else if (!event.shiftKey && index === last) {
    next = stops[0]
  } else {
    // The browser's own order is right within the panel, but not between it and the toasts.
    const neighbour = stops[index + (event.shiftKey ? -1 : 1)]
    if (panel.contains(activeElement) !== panel.contains(neighbour ?? null)) next = neighbour
  }
  if (!next) return
  event.preventDefault()
  next.focus()
}

/** For layers that belong to a wide or narrow window only. */
export function useOnMediaMatch(query: string, onMatch: () => void) {
  const latest = useRef(onMatch)
  useLayoutEffect(() => {
    latest.current = onMatch
  })
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => {
      if (media.matches) latest.current()
    }
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
}
