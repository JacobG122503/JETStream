import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useRef,
} from 'react'
import { IconButton } from './Button'
import { classNames } from './classNames'
import { FieldFrame, FieldMessages, type FieldProps, RequiredMark, useFieldIds } from './Field'
import { Icon } from './Icon'

type Native<T, Omitted extends string = never> = Omit<T, keyof FieldProps | 'onChange' | 'value' | Omitted>

export interface TextFieldProps extends FieldProps, Native<InputHTMLAttributes<HTMLInputElement>, 'type' | 'prefix'> {
  type?: 'text' | 'email' | 'password' | 'number'
  value: string
  onChange: (value: string) => void
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hideLabel, hint, error, required, disabled, id, className, type = 'text', onChange, ...rest },
  ref,
) {
  const ids = useFieldIds({ id, hint, error })
  return (
    <FieldFrame {...{ ids, label, hideLabel, hint, error, required, className }}>
      <input
        {...rest}
        ref={ref}
        id={ids.controlId}
        type={type}
        className="control"
        required={required}
        disabled={disabled}
        aria-invalid={ids.invalid}
        aria-describedby={ids.describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldFrame>
  )
})

export interface TextAreaProps extends FieldProps, Native<TextareaHTMLAttributes<HTMLTextAreaElement>> {
  value: string
  onChange: (value: string) => void
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hideLabel, hint, error, required, disabled, id, className, rows = 4, onChange, ...rest },
  ref,
) {
  const ids = useFieldIds({ id, hint, error })
  return (
    <FieldFrame {...{ ids, label, hideLabel, hint, error, required, className }}>
      <textarea
        {...rest}
        ref={ref}
        id={ids.controlId}
        rows={rows}
        className="control control-multiline"
        required={required}
        disabled={disabled}
        aria-invalid={ids.invalid}
        aria-describedby={ids.describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldFrame>
  )
})

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends FieldProps, Native<SelectHTMLAttributes<HTMLSelectElement>, 'multiple'> {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /** Text of an extra first option with an empty value. */
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hideLabel, hint, error, required, disabled, id, className, options, placeholder, onChange, ...rest },
  ref,
) {
  const ids = useFieldIds({ id, hint, error })
  return (
    <FieldFrame {...{ ids, label, hideLabel, hint, error, required, className }}>
      <div className="control-wrap">
        <select
          {...rest}
          ref={ref}
          id={ids.controlId}
          className="control control-select"
          required={required}
          disabled={disabled}
          aria-invalid={ids.invalid}
          aria-describedby={ids.describedBy}
          onChange={(event) => onChange(event.target.value)}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" className="control-chevron" />
      </div>
    </FieldFrame>
  )
})

export interface SearchFieldProps extends FieldProps, Native<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value: string
  onChange: (value: string) => void
}

export function SearchField({ label, hideLabel, hint, error, required, disabled, id, className, value, onChange, ...rest }: SearchFieldProps) {
  const ids = useFieldIds({ id, hint, error })
  const input = useRef<HTMLInputElement>(null)
  const clearable = value !== '' && !disabled && !rest.readOnly
  return (
    <FieldFrame {...{ ids, label, hideLabel, hint, error, required, className }}>
      <div className="control-wrap">
        <Icon name="search" className="control-lead" />
        <input
          {...rest}
          ref={input}
          id={ids.controlId}
          type="search"
          value={value}
          className={classNames('control control-has-lead', clearable && 'control-has-1-button')}
          required={required}
          disabled={disabled}
          aria-invalid={ids.invalid}
          aria-describedby={ids.describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        {clearable && (
          <div className="control-buttons">
            <IconButton
              icon="close"
              label={`Clear ${label}`}
              className="control-button"
              onClick={() => {
                onChange('')
                input.current?.focus()
              }}
            />
          </div>
        )}
      </div>
    </FieldFrame>
  )
}

export interface CheckboxProps extends FieldProps, Native<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked'> {
  checked: boolean
  /** Neither on nor off: some of several things are selected. */
  indeterminate?: boolean
  onChange: (checked: boolean) => void
}

export function Checkbox({ label, hideLabel, hint, error, required, disabled, id, className, checked, indeterminate = false, onChange, ...rest }: CheckboxProps) {
  const ids = useFieldIds({ id, hint, error })
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate
  }, [indeterminate, checked])
  return (
    <div className={classNames('field', className)}>
      <label className={classNames('choice', hideLabel && 'choice-bare', disabled && 'is-disabled')} htmlFor={ids.controlId}>
        <input
          {...rest}
          ref={input}
          id={ids.controlId}
          type="checkbox"
          className="check"
          checked={checked}
          required={required}
          disabled={disabled}
          aria-invalid={ids.invalid}
          aria-describedby={ids.describedBy}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className={hideLabel ? 'sr-only' : 'choice-label'}>
          {label} {required && <RequiredMark />}
        </span>
      </label>
      <FieldMessages ids={ids} hint={hint} error={error} />
    </div>
  )
}

export interface SwitchProps extends FieldProps {
  checked: boolean
  onChange: (checked: boolean) => void
}

/** For a setting that applies at once. Use Checkbox for something that is submitted later. */
export function Switch({ label, hideLabel, hint, error, required, disabled, id, className, checked, onChange }: SwitchProps) {
  const ids = useFieldIds({ id, hint, error })
  return (
    <div className={classNames('field', className)}>
      <label className={classNames('choice', disabled && 'is-disabled')} htmlFor={ids.controlId}>
        <input
          id={ids.controlId}
          type="checkbox"
          role="switch"
          className="switch"
          checked={checked}
          required={required}
          disabled={disabled}
          aria-invalid={ids.invalid}
          aria-describedby={ids.describedBy}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className={hideLabel ? 'sr-only' : 'choice-label'}>
          {label} {required && <RequiredMark />}
        </span>
      </label>
      <FieldMessages ids={ids} hint={hint} error={error} />
    </div>
  )
}

export interface RadioOption {
  value: string
  label: string
  hint?: ReactNode
  disabled?: boolean
}

export interface RadioGroupProps extends FieldProps {
  value: string
  onChange: (value: string) => void
  options: RadioOption[]
}

export function RadioGroup({ label, hideLabel, hint, error, required, disabled, id, className, value, onChange, options }: RadioGroupProps) {
  const ids = useFieldIds({ id, hint, error })
  return (
    <div
      role="radiogroup"
      id={ids.controlId}
      className={classNames('field', className)}
      aria-labelledby={ids.labelId}
      aria-describedby={ids.describedBy}
      aria-invalid={ids.invalid}
      aria-required={required || undefined}
      aria-disabled={disabled || undefined}
    >
      <span className={classNames('field-label', hideLabel && 'sr-only')} id={ids.labelId}>
        {label} {required && <RequiredMark />}
      </span>
      <div className="choice-list">
        {options.map((option) => {
          const optionId = `${ids.controlId}-${option.value}`
          const off = disabled || option.disabled
          const hasHint = option.hint !== undefined
          return (
            <label key={option.value} className={classNames('choice', off && 'is-disabled')} htmlFor={optionId}>
              <input
                id={optionId}
                type="radio"
                className="radio"
                name={ids.controlId}
                value={option.value}
                checked={option.value === value}
                disabled={off}
                aria-describedby={hasHint ? `${optionId}-hint` : undefined}
                onChange={() => onChange(option.value)}
              />
              <span className="choice-label">
                {option.label}
                {hasHint && (
                  <span className="field-hint choice-hint" id={`${optionId}-hint`}>
                    {option.hint}
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>
      <FieldMessages ids={ids} hint={hint} error={error} />
    </div>
  )
}
