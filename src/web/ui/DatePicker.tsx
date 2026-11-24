import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { Button, IconButton } from './Button'
import { Calendar } from './Calendar'
import { type IsoDate, formatDate, isIsoDate, parseDate, todayOnDevice, type Weekday } from './dates'
import { FieldFrame, type FieldProps, useFieldIds } from './Field'
import { tabbable } from './overlay/focus'
import { popupAttributes, usePopup } from './overlay/usePopup'
import './DatePicker.css'
import './popup.css'

export interface DatePickerProps extends FieldProps {
  /** YYYY-MM-DD, or empty. */
  value: IsoDate
  /** Called with a real date inside min and max, or with an empty string; never with anything else. */
  onChange: (value: IsoDate) => void
  /** Tells what is wrong with the text in the field, or null. While there is a problem, `value` is the last good one. */
  onProblemChange?: (problem: string | null) => void
  min?: IsoDate
  max?: IsoDate
  /** First day of the week in the calendar. Monday by default. */
  weekStart?: Weekday
  /** Today, where it is not the device's date, such as in the company's time zone. */
  today?: IsoDate
  readOnly?: boolean
}

const shown = (value: string) => (isIsoDate(value) ? formatDate(value) : '')

export function DatePicker({
  label, hideLabel, hint, error, required, disabled, id, className,
  value, onChange, onProblemChange, min, max, weekStart = 1, today = todayOnDevice(), readOnly,
}: DatePickerProps) {
  /** What is in the field when it is not the value: being typed, or not a date. */
  const [draft, setDraft] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [lastValue, setLastValue] = useState(value)
  const anchor = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const popupId = useId()

  // A new value from outside replaces what was typed.
  if (value !== lastValue) {
    setLastValue(value)
    setDraft(null)
    setProblem(null)
  }

  const report = useRef(onProblemChange)
  useEffect(() => {
    report.current = onProblemChange
  })
  useEffect(() => report.current?.(problem), [problem])

  const shownError = problem ?? error
  const ids = useFieldIds({ id, hint, error: shownError })
  const style = usePopup({ open, anchorRef: anchor, popupRef: popup, onPressOutside: () => setOpen(false) })

  const rangeProblem = (date: IsoDate) => {
    if (min && date < min) return `Enter a date on or after ${formatDate(min)}`
    if (max && date > max) return `Enter a date on or before ${formatDate(max)}`
    return null
  }

  const accept = (next: IsoDate) => {
    setDraft(null)
    setProblem(null)
    if (next !== value) onChange(next)
  }

  const commit = () => {
    if (draft === null) return
    if (draft.trim() === '') return accept('')
    const date = parseDate(draft)
    const trouble = date === null ? 'Enter a date such as 11/23/2026 or 2026-11-23' : rangeProblem(date)
    if (date !== null && trouble === null) accept(date)
    else setProblem(trouble)
  }

  const closeCalendar = () => {
    setOpen(false)
    opener.current?.focus()
  }
  const pick = (date: IsoDate) => {
    accept(date)
    closeCalendar()
  }

  const onPopupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeCalendar()
    } else if (event.key === 'Tab') {
      // Focus stays in the calendar until it is closed.
      const stops = tabbable(event.currentTarget)
      const index = stops.indexOf(document.activeElement as HTMLElement)
      const next = event.shiftKey ? (index <= 0 ? stops.at(-1) : undefined) : index === stops.length - 1 ? stops[0] : undefined
      if (next) {
        event.preventDefault()
        next.focus()
      }
    }
  }

  const editable = !disabled && !readOnly
  const clearable = editable && (value !== '' || Boolean(draft))
  return (
    <FieldFrame {...{ ids, label, hideLabel, hint, required, className }} error={shownError}>
      <div
        ref={anchor}
        className="control-wrap date-picker"
        onBlur={(event) => {
          if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
        }}
      >
        <input
          ref={input}
          id={ids.controlId}
          type="text"
          className={clearable ? 'control control-has-2-buttons' : 'control control-has-1-button'}
          autoComplete="off"
          placeholder="M/D/YYYY"
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={ids.invalid}
          aria-describedby={ids.describedBy}
          value={draft ?? shown(value)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            else if (event.key === 'ArrowDown' && event.altKey && editable) {
              event.preventDefault()
              setOpen(true)
            }
          }}
        />
        <div className="control-buttons">
          {clearable && (
            <IconButton
              icon="close"
              label={`Clear ${label}`}
              className="control-button"
              onClick={() => {
                accept('')
                input.current?.focus()
              }}
            />
          )}
          {!readOnly && (
            <IconButton
              ref={opener}
              icon="calendar"
              label={`Choose ${label} from a calendar`}
              className="control-button"
              disabled={disabled}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={open ? popupId : undefined}
              onClick={() => setOpen(!open)}
            />
          )}
        </div>
        {open && (
          <div
            {...popupAttributes}
            ref={popup}
            id={popupId}
            role="dialog"
            aria-label={`Calendar for ${label}`}
            className="popup date-popup"
            style={style}
            onKeyDown={onPopupKeyDown}
          >
            <Calendar value={value} min={min} max={max} today={today} weekStart={weekStart} onPick={pick} />
            <div className="date-popup-footer">
              <Button size="small" disabled={rangeProblem(today) !== null} onClick={() => pick(today)}>
                Today
              </Button>
              <Button size="small" variant="quiet" disabled={!clearable} onClick={() => pick('')}>
                Clear
              </Button>
            </div>
          </div>
        )}
      </div>
    </FieldFrame>
  )
}
