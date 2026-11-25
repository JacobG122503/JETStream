import { useCallback, useEffect, useState } from 'react'
import { callApi, errorMessage } from '../api'

export interface Load<T> {
  status: 'loading' | 'ready' | 'error'
  data: T | undefined
  error: string
  /** Starts over, showing that it loads. */
  reload: () => void
  /** Loads again behind what is shown. */
  refresh: () => void
  /** Takes over what a change answered. */
  setData: (data: T) => void
}

interface State<T> extends Pick<Load<T>, 'status' | 'data' | 'error'> {
  /** Where the data is from. */
  route?: string
}

/** Loads something from the API when the component appears. */
export function useLoad<T>(route: string): Load<T> {
  const [state, setState] = useState<State<T>>({ status: 'loading', data: undefined, error: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    callApi<T>('GET', route).then(
      (data) => {
        if (current) setState({ status: 'ready', data, error: '', route })
      },
      (error: unknown) => {
        if (current) setState((before) => (before.status === 'ready' && before.route === route ? before : { status: 'error', data: undefined, error: errorMessage(error) }))
      },
    )
    return () => {
      current = false
    }
  }, [route, attempt])

  const reload = useCallback(() => {
    setState({ status: 'loading', data: undefined, error: '' })
    setAttempt((count) => count + 1)
  }, [])
  const refresh = useCallback(() => setAttempt((count) => count + 1), [])
  const setData = useCallback((data: T) => setState({ status: 'ready', data, error: '', route }), [route])
  return { ...state, reload, refresh, setData }
}
