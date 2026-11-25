import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * The secret of an invite or reset link, which is the fragment of its address. It is taken out of
 * the address bar at once, and kept only in this page's memory.
 */
export function useLinkToken(): string {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const [token, setToken] = useState(hash.slice(1))
  useEffect(() => {
    if (hash === '') return
    // Another link may be opened in the same tab.
    setToken(hash.slice(1))
    navigate({ pathname, search, hash: '' }, { replace: true })
  }, [hash, pathname, search, navigate])
  return token
}
