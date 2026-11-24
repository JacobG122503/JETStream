import { useEffect, useState } from 'react'
import { apiUrl } from './basePath'
import { Button } from './ui'

type State = 'checking' | 'connected' | 'failed'

const messages: Record<State, string> = {
  checking: 'Checking server...',
  connected: 'Server connected',
  failed: 'Cannot reach the server',
}

const timeoutMs = 10_000

/** Shows whether the server and its database answer. */
export function ServerStatus() {
  const [state, setState] = useState<State>('checking')
  const [attempt, setAttempt] = useState(1)

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    void fetch(apiUrl('health'), { signal: controller.signal })
      .then(async (response) => {
        // Until the body is read, the browser counts the request as unfinished, and cancels it
        // when the page is left.
        await response.text()
        return response.status === 200
      })
      .catch(() => false)
      .then((ok) => {
        clearTimeout(timer)
        if (current) setState(ok ? 'connected' : 'failed')
      })
    // The request is left to finish: cancelling it would show as a failed request.
    return () => {
      current = false
    }
  }, [attempt])

  // During a retry the button stays, so that keyboard focus is not lost if it fails again.
  const retrying = state === 'checking' && attempt > 1

  return (
    <>
      <p role="status">{messages[state]}</p>
      {(state === 'failed' || retrying) && (
        <Button
          aria-disabled={retrying}
          onClick={() => {
            setState('checking')
            setAttempt(attempt + 1)
          }}
        >
          Try again
        </Button>
      )}
    </>
  )
}
