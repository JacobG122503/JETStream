import { useCallback, useRef, useState } from 'react'
import { ApiError, errorMessage } from '../api'
import type { FormError } from '../ui'

export interface Form {
  /** A request is on its way. */
  busy: boolean
  /** Something that concerns no single field. */
  problem: string | null
  /** The server's code for it, such as stale. */
  problemCode: string | null
  /** For FormErrorSummary. */
  errors: FormError[]
  submitCount: number
  /** Ties a field to the form: its id and its error. */
  field: (name: string) => { id: string; error: string | null }
  /**
   * Runs the request unless one is running. `problems` are those found before sending, by field.
   * A field that the server complains about is marked as well.
   */
  submit: (work: () => Promise<void>, problems?: Record<string, string | null | undefined>) => Promise<void>
  /** Forgets what went wrong. */
  clear: () => void
}

/** `name` makes the ids of the fields; `fields` are in the order they are shown. */
export function useForm(name: string, fields: readonly string[]): Form {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ message: string; code: string | null } | null>(null)
  const [found, setFound] = useState<Record<string, string>>({})
  const [submitCount, setSubmitCount] = useState(0)

  const submit: Form['submit'] = useCallback(
    async (work, problems = {}) => {
      // A ref as well as state: a second press can come before the next render.
      if (running.current) return
      const fail = (wrong: Record<string, string>, general: typeof problem) => {
        setFound(wrong)
        setProblem(general)
        setSubmitCount((count) => count + 1)
      }
      const early = Object.fromEntries(Object.entries(problems).filter((entry): entry is [string, string] => Boolean(entry[1])))
      if (Object.keys(early).length > 0) {
        fail(early, null)
        return
      }
      running.current = true
      setBusy(true)
      try {
        await work()
        setFound({})
        setProblem(null)
      } catch (error) {
        const wrong = error instanceof ApiError ? error.fields : {}
        const known = Object.keys(wrong).some((field) => fields.includes(field))
        const code = error instanceof ApiError ? error.code : null
        fail(known ? wrong : {}, known ? null : { message: errorMessage(error), code })
      } finally {
        running.current = false
        setBusy(false)
      }
    },
    [fields],
  )

  const id = (field: string) => `${name}-${field}`
  return {
    busy,
    problem: problem?.message ?? null,
    problemCode: problem?.code ?? null,
    errors: fields.flatMap((field) => (found[field] ? [{ fieldId: id(field), message: found[field] }] : [])),
    submitCount,
    field: (field) => ({ id: id(field), error: found[field] ?? null }),
    submit,
    clear: () => {
      setFound({})
      setProblem(null)
    },
  }
}
