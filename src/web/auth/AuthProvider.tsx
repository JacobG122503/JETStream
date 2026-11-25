import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionInfo } from '../../shared/api'
import { ApiError, callApi, connectApi } from '../api'
import { useToast } from '../ui'
import { setFormats } from '../work/format'
import { type Auth, AuthContext } from './authContext'

interface State {
  status: Auth['status']
  info: SessionInfo | null
  left: Auth['left']
}

/** Knows who is signed in, and keeps that in step with the server and other tabs. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [state, setState] = useState<State>({ status: 'loading', info: null, left: null })
  const latest = useRef(state)
  /** Counts what this page itself did, so that an older answer does not undo it. */
  const generation = useRef(0)
  const running = useRef<Promise<void> | null>(null)

  const set = useCallback((next: State) => {
    if (next.info) setFormats(next.info.company.formats)
    latest.current = next
    setState(next)
  }, [])

  const accept = useCallback(
    (info: SessionInfo) => {
      generation.current++
      const { info: before, left } = latest.current
      const signedOut = before?.person != null && info.person === null
      set({ status: 'ready', info, left: signedOut ? { how: 'signed-out' } : info.person ? null : left })
    },
    [set],
  )

  const refresh = useCallback((): Promise<void> => {
    running.current ??= (async () => {
      const asked = generation.current
      try {
        const info = await callApi<SessionInfo>('GET', 'session')
        if (asked !== generation.current) return
        const { info: before, left } = latest.current
        const [was, is] = [before?.person, info.person]
        // Signed in from another tab as someone else: everything shown belongs to the wrong person.
        if (was && is && was.id !== is.id) {
          toast.warning(`Someone else signed in on this browser. You are now working as ${is.name}.`)
        }
        set({ status: 'ready', info, left: is ? null : was ? { how: 'ended', personId: was.id } : left })
      } catch {
        // Once something is shown, it stays; the next request tells what is wrong.
        if (latest.current.status !== 'ready') set({ status: 'failed', info: null, left: null })
      } finally {
        running.current = null
      }
    })()
    return running.current
  }, [set, toast])

  const signOut = useCallback(async () => {
    try {
      accept(await callApi<SessionInfo>('POST', 'session/sign-out'))
    } catch (error) {
      // Refused because the session is another one by now: what is shown has been brought up to date.
      if (!(error instanceof ApiError) || error.code !== 'csrf') throw error
    }
  }, [accept])

  useEffect(() => {
    connectApi({
      csrfToken: () => latest.current.info?.csrfToken ?? null,
      access: () => latest.current.info?.person?.access ?? null,
      onAccessChanged: () => void refresh(),
      onRefused: async (code) => {
        const before = latest.current.info?.person?.id
        await refresh()
        // Another session of the same person, for example after signing in again in another tab.
        return code === 'csrf' && before !== undefined && latest.current.info?.person?.id === before
      },
    })
    void refresh()
  }, [refresh])

  // Another tab may have signed out, or in as someone else.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible' && latest.current.status === 'ready') void refresh()
    }
    const checkRestored = (event: PageTransitionEvent) => {
      if (event.persisted) check()
    }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('pageshow', checkRestored)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('pageshow', checkRestored)
    }
  }, [refresh])

  const auth = useMemo<Auth>(() => ({ ...state, accept, refresh, signOut }), [state, accept, refresh, signOut])
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}
