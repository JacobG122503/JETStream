import { type ReactNode, useId } from 'react'
import { classNames } from './classNames'
import { Icon } from './Icon'
import './Field.css'

/** What every field accepts. */
export interface FieldProps {
  label: string
  /** Hides the label from view but not from screen readers. */
  hideLabel?: boolean
  hint?: ReactNode
  /** Shown in place of nothing, next to the control, and tied to it. */
  error?: string | null
  required?: boolean
  disabled?: boolean
  /** Also the target of FormErrorSummary entries. Made up when not given. */
  id?: string
  className?: string
}

/** Ids and attributes that tie a control to its label, hint and error. */
// eslint-disable-next-line react-refresh/only-export-components -- belongs to the parts below
export function useFieldIds({ id, hint, error }: Pick<FieldProps, 'id' | 'hint' | 'error'>) {
  const made = useId()
  const controlId = id ?? made
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`
  return {
    controlId,
    labelId: `${controlId}-label`,
    hintId,
    errorId,
    describedBy: classNames(hint !== undefined && hint !== null && hintId, error && errorId) || undefined,
    invalid: error ? (true as const) : undefined,
  }
}

export type FieldIds = ReturnType<typeof useFieldIds>

export function RequiredMark() {
  return <span className="field-required">(required)</span>
}

export function FieldMessages({ ids, hint, error }: { ids: FieldIds } & Pick<FieldProps, 'hint' | 'error'>) {
  return (
    <>
      {hint !== undefined && hint !== null && (
        <p className="field-hint" id={ids.hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={ids.errorId}>
          <Icon name="error" />
          <span>
            <span className="sr-only">Error: </span>
            {error}
          </span>
        </p>
      )}
    </>
  )
}

interface FieldFrameProps extends Omit<FieldProps, 'id'> {
  ids: FieldIds
  /** For controls that are not labelled through `for`. */
  labelAs?: 'label' | 'span'
  children: ReactNode
}

export function FieldFrame({ ids, label, hideLabel, hint, error, required, className, labelAs = 'label', children }: FieldFrameProps) {
  const content = (
    <>
      {label} {required && <RequiredMark />}
    </>
  )
  const labelClass = classNames('field-label', hideLabel && 'sr-only')
  return (
    <div className={classNames('field', className)}>
      {labelAs === 'label' ? (
        <label className={labelClass} htmlFor={ids.controlId} id={ids.labelId}>
          {content}
        </label>
      ) : (
        <span className={labelClass} id={ids.labelId}>
          {content}
        </span>
      )}
      {children}
      <FieldMessages ids={ids} hint={hint} error={error} />
    </div>
  )
}
