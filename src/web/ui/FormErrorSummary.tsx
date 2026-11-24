import { useEffect, useId, useRef } from 'react'
import { focusField } from './overlay/focus'
import { Icon } from './Icon'

export interface FormError {
  /** The `id` given to the field. */
  fieldId: string
  message: string
}

export interface FormErrorSummaryProps {
  errors: FormError[]
  /** Count of submits so far. The summary takes focus each time this grows and there are errors. */
  submitCount: number
}

export function FormErrorSummary({ errors, submitCount }: FormErrorSummaryProps) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (submitCount > 0) box.current?.focus()
  }, [submitCount])

  if (errors.length === 0) return null
  return (
    <div ref={box} className="error-summary" role="group" tabIndex={-1} aria-labelledby={titleId}>
      <Icon name="error" />
      <div>
        <p id={titleId} className="error-summary-title">
          {errors.length === 1 ? 'There is a problem' : `There are ${errors.length} problems`}
        </p>
        <ul>
          {errors.map((error) => (
            <li key={error.fieldId}>
              <a
                href={`#${error.fieldId}`}
                onClick={(event) => {
                  event.preventDefault()
                  focusField(error.fieldId)
                }}
              >
                {error.message}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
