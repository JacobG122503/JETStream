import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

// An item may hold a comma itself.
function decode(item: string): string {
  try {
    return decodeURIComponent(item)
  } catch {
    return item
  }
}

/** What is chosen on a page, kept in its address, so that it can be linked to and saved. */
export function useQuery() {
  const [params, setParams] = useSearchParams()
  /** Empty values are left out of the address. */
  const change = useCallback(
    (patch: Record<string, string | readonly (string | number)[] | null>) => {
      setParams(
        (before) => {
          const next = new URLSearchParams(before)
          for (const [name, value] of Object.entries(patch)) {
            const text = typeof value === 'string' || value === null ? value : value.map((item) => encodeURIComponent(item)).join(',')
            if (text) next.set(name, text)
            else next.delete(name)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
  return {
    get: (name: string) => params.get(name) ?? '',
    list: (name: string) => (params.get(name) ?? '').split(',').filter(Boolean).map(decode),
    change,
  }
}
