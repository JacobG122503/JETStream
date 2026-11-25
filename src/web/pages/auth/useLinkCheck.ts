import { useCallback, useEffect, useState } from 'react'
import { ApiError, callApi } from '../../api'

/** Asks the server what a link is for. Does not use it up. */
export function useLinkCheck<T>(route: string, token: string, enabled: boolean) {
  const [result, setResult] = useState<{ token: string; data: T | null; error: unknown }>({ token: '', data: null, error: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let current = true
    const show = (data: T | null, error: unknown) => {
      if (current) setResult({ token, data, error })
    }
    if (token === '') show(null, new ApiError(410, 'link_invalid', ''))
    else callApi<T>('POST', route, { token }).then((data) => show(data, null), (error: unknown) => show(null, error))
    return () => {
      current = false
    }
  }, [route, token, enabled, attempt])
  const retry = useCallback(() => {
    setResult({ token: '', data: null, error: null })
    setAttempt((count) => count + 1)
  }, [])
  /** For a link that stopped working after it was checked. */
  const fail = useCallback((error: unknown) => setResult((before) => ({ ...before, data: null, error })), [])
  // The answer for another token does not count.
  const own = result.token === token
  return { data: own ? result.data : null, error: own ? result.error : null, retry, fail }
}
