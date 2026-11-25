import { type ReactNode, useState } from 'react'
import { callApi, errorMessage } from '../api'
import { ConfirmDialog, useToast } from '../ui'

export interface Action {
  title: string
  message: ReactNode
  confirmLabel: string
  destructive?: boolean
  method?: 'POST' | 'PUT' | 'DELETE'
  route: string
  body?: object
  /** Said when it is done; empty where `then` says it. */
  done: string
  then: (answer: never) => void
}

/** Things that are done after a question. `ask` puts the question; `dialog` belongs into the page. */
export function useActions() {
  const toast = useToast()
  const [action, setAction] = useState<Action | null>(null)
  const dialog = (
    <ConfirmDialog
      open={action !== null}
      onClose={() => setAction(null)}
      title={action?.title ?? ''}
      message={action?.message ?? ''}
      confirmLabel={action?.confirmLabel ?? ''}
      destructive={action?.destructive}
      onConfirm={async () => {
        if (!action) return
        try {
          const answer = await callApi(action.method ?? 'POST', action.route, action.body)
          if (action.done) toast.success(action.done)
          action.then(answer as never)
        } catch (reason) {
          throw new Error(errorMessage(reason), { cause: reason })
        }
      }}
    />
  )
  /** Without a question. */
  const run = async (method: 'POST' | 'PUT' | 'DELETE', route: string, body: object | undefined, done: string, then: (answer: never) => void) => {
    try {
      const answer = await callApi(method, route, body)
      if (done) toast.success(done)
      then(answer as never)
    } catch (reason) {
      toast.error(errorMessage(reason))
    }
  }
  return { ask: setAction, run, dialog }
}
