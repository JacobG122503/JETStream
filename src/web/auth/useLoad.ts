import { useCallback, useEffect, useState } from 'react'
import { callApi, errorMessage } from '../api'

export interface Load<T> {
  status: 'loading' | 'ready' | 'error'
  data: T | undefined
  error: string
  reload: () => void
  /** Takes over what a change answered. */
  setData: (data: T) => void
}

/** Loads something from the API when the component appears. */
export function useLoad<T>(route: string): Load<T> {
  const [state, setState] = useState<Pick<Load<T>, 'status' | 'data' | 'error'>>({ status: 'loading', data: undefined, error: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    callApi<T>('GET', route).then(
      (data) => {
        if (current) setState({ status: 'ready', data, error: '' })
      },
      (error: unknown) => {
        if (current) setState({ status: 'error', data: undefined, error: errorMessage(error) })
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
  const setData = useCallback((data: T) => setState({ status: 'ready', data, error: '' }), [])
  return { ...state, reload, setData }
}
