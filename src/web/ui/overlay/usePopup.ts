import { type CSSProperties, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface PopupOptions {
  open: boolean
  anchorRef: RefObject<HTMLElement>
  popupRef: RefObject<HTMLElement>
  align?: 'start' | 'end' | 'center'
  side?: 'below' | 'above'
  /** Makes the popup at least as wide as the anchor. */
  matchWidth?: boolean
  /** Pointer pressed outside the anchor and the popup. */
  onPressOutside?: () => void
}

/** React 18's types do not know this attribute. */
export const popupAttributes = { popover: 'manual' } as Record<string, string>

const margin = 8
const gap = 4

/**
 * Places a popup next to its anchor, inside the window. The popup is in the browser's top layer
 * (popover="manual"), so no scrolling container or dialog cuts it off, but stays where it is in
 * the document, so focus order and dialogs' focus handling include it.
 */
export function usePopup({ open, anchorRef, popupRef, align = 'start', side = 'below', matchWidth, onPressOutside }: PopupOptions) {
  const [style, setStyle] = useState<CSSProperties>({})
  const latestPressOutside = useRef(onPressOutside)
  useLayoutEffect(() => {
    latestPressOutside.current = onPressOutside
  })

  const place = useCallback(() => {
    const anchor = anchorRef.current
    const popup = popupRef.current
    if (!anchor || !popup) return
    const rect = anchor.getBoundingClientRect()
    const width = document.documentElement.clientWidth
    const height = window.innerHeight
    // Natural size: without the limit set last time.
    const { scrollTop } = popup
    popup.style.maxHeight = ''
    const size = { width: popup.offsetWidth, height: popup.scrollHeight + popup.offsetHeight - popup.clientHeight }
    const below = height - rect.bottom - gap - margin
    const above = rect.top - gap - margin
    const goAbove = side === 'above' ? above >= size.height || above > below : below < size.height && above > below
    const maxHeight = Math.max(goAbove ? above : below, 96)
    const shownHeight = Math.min(size.height, maxHeight)
    let left = rect.left
    if (align === 'end') left = rect.right - size.width
    if (align === 'center') left = rect.left + (rect.width - size.width) / 2
    left = Math.max(margin, Math.min(left, width - size.width - margin))
    const next: CSSProperties = {
      left,
      top: goAbove ? Math.max(margin, rect.top - gap - shownHeight) : rect.bottom + gap,
      maxHeight,
      minWidth: matchWidth ? Math.min(rect.width, width - 2 * margin) : undefined,
    }
    popup.style.maxHeight = `${maxHeight}px`
    popup.scrollTop = scrollTop
    setStyle((current) =>
      (Object.keys(next) as (keyof CSSProperties)[]).every((key) => current[key] === next[key]) ? current : next,
    )
  }, [align, anchorRef, matchWidth, popupRef, side])

  useLayoutEffect(() => {
    if (!open) return
    const popup = popupRef.current
    // Not in jsdom.
    if (popup && typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) popup.showPopover()
    place()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : undefined
    if (popup) observer?.observe(popup)
    if (anchorRef.current) observer?.observe(anchorRef.current)
    window.addEventListener('resize', place)
    const onScroll = (event: Event) => {
      if (!popup?.contains(event.target as Node)) place()
    }
    window.addEventListener('scroll', onScroll, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, place, anchorRef, popupRef])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || popupRef.current?.contains(target)) return
      latestPressOutside.current?.()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, anchorRef, popupRef])

  return style
}
