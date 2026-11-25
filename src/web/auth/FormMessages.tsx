import { useEffect, useRef } from 'react'
import { Button, FormErrorSummary, Notice } from '../ui'
import type { Form } from './useForm'

export interface FormMessagesProps {
  form: Form
  /** For forms that change a record: shows what it is now, after someone else changed it. */
  onReload?: () => void
}

/** What went wrong with the last submit. Takes focus, so that nobody misses it. */
export function FormMessages({ form, onReload }: FormMessagesProps) {
  const box = useRef<HTMLDivElement>(null)
  const { problem, submitCount } = form
  useEffect(() => {
    if (problem !== null && submitCount > 0) box.current?.focus()
  }, [problem, submitCount])
  return (
    <>
      <FormErrorSummary errors={form.errors} submitCount={form.submitCount} />
      {problem !== null && (
        <div ref={box} tabIndex={-1} className="form-problem">
          <Notice
            tone="danger"
            announce="alert"
            action={
              onReload &&
              form.problemCode === 'stale' && (
                <Button icon="refresh" onClick={onReload}>
                  Discard my changes and reload
                </Button>
              )
            }
          >
            {problem}
          </Notice>
        </div>
      )}
    </>
  )
}
