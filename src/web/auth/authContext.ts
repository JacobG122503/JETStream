import { createContext, useContext } from 'react'
import type { SessionInfo, SessionPerson } from '../../shared/api'

export interface Auth {
  status: 'loading' | 'failed' | 'ready'
  /** Null until the server answered. */
  info: SessionInfo | null
  /** How this page came to be signed out. */
  left: { how: 'signed-out' } | { how: 'ended'; personId: number } | null
  /** Takes over what the server answered to signing in and the like. */
  accept: (info: SessionInfo) => void
  /** Asks the server again who is signed in. */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<Auth | null>(null)

export function useAuth(): Auth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth needs an AuthProvider')
  return auth
}

/** The signed-in person. Only for pages that need one. */
export function usePerson(): SessionPerson {
  const { info } = useAuth()
  if (!info?.person) throw new Error('Nobody is signed in')
  return info.person
}
