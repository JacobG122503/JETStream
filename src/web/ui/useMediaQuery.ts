import { useCallback, useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}

/** Below this width, tables stack and the phone layout applies. */
export const narrowQuery = '(max-width: 639.98px)'
/** From this width, navigation is a sidebar. */
export const wideQuery = '(min-width: 1024px)'
