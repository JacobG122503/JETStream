import { useState } from 'react'
import { DatePicker } from './DatePicker'
import {
  type DateRange, formatDate, isIsoDate, type IsoDate, matchPreset, presetRange, type RangePresetId, rangePresets, todayOnDevice, type Weekday,
} from './dates'
import { FieldMessages, type FieldProps, RequiredMark, useFieldIds } from './Field'
import { classNames } from './classNames'
import { Select } from './fields'

export interface DateRangePickerProps extends Omit<FieldProps, 'hideLabel'> {
  /** Both dates, or both empty. */
  value: DateRange
  /** Called with two dates in order, or with both empty; never with half a range. */
  onChange: (value: DateRange) => void
  weekStart?: Weekday
  today?: IsoDate
}

const custom = 'custom'

export function DateRangePicker({
  label, hint, error, required, disabled, id, className, value, onChange, weekStart = 1, today = todayOnDevice(),
}: DateRangePickerProps) {
  const [draft, setDraft] = useState<DateRange>(value)
  const [lastValue, setLastValue] = useState(value)
  const [chosenCustom, setChosenCustom] = useState(false)

  // A new value from outside replaces the dates shown.
  if (value.start !== lastValue.start || value.end !== lastValue.end) {
    setLastValue(value)
    setDraft(value)
  }

  const backwards = isIsoDate(draft.start) && isIsoDate(draft.end) && draft.end < draft.start
  const problem = backwards ? `The end date must be on or after ${formatDate(draft.start)}` : null
  const half = (draft.start === '') !== (draft.end === '')
  const shownHint = half && !problem ? `Enter ${draft.start === '' ? 'a start' : 'an end'} date to use this range.` : hint
  const ids = useFieldIds({ id, hint: shownHint, error })
  const preset = chosenCustom ? custom : (matchPreset(draft, today, weekStart) ?? custom)

  const edit = (next: DateRange) => {
    setDraft(next)
    setChosenCustom(true)
    const complete = next.start !== '' && next.end !== ''
    const empty = next.start === '' && next.end === ''
    if (empty || (complete && next.start <= next.end)) {
      if (next.start !== value.start || next.end !== value.end) onChange(next)
    }
  }

  const choosePreset = (next: string) => {
    if (next === custom) {
      setChosenCustom(true)
      return
    }
    const range = presetRange(next as RangePresetId, today, weekStart)
    setChosenCustom(false)
    setDraft(range)
    if (range.start !== value.start || range.end !== value.end) onChange(range)
  }

  const picker = (side: 'start' | 'end') => (
    <DatePicker
      label={side === 'start' ? 'Start date' : 'End date'}
      value={draft[side]}
      disabled={disabled}
      weekStart={weekStart}
      today={today}
      error={side === 'end' ? problem : null}
      onChange={(date) => edit({ ...draft, [side]: date })}
    />
  )

  return (
    <div
      role="group"
      id={ids.controlId}
      className={classNames('field', className)}
      aria-labelledby={ids.labelId}
      aria-describedby={ids.describedBy}
    >
      <span className="field-label" id={ids.labelId}>
        {label} {required && <RequiredMark />}
      </span>
      <div className={classNames('date-range', error && 'is-invalid')}>
        <Select
          label="Period"
          value={preset}
          disabled={disabled}
          options={[...rangePresets.map(({ id: value, label: text }) => ({ value, label: text })), { value: custom, label: 'Custom' }]}
          onChange={choosePreset}
        />
        {picker('start')}
        {picker('end')}
        <div className="date-range-messages">
          <FieldMessages ids={ids} hint={shownHint} error={error} />
        </div>
      </div>
    </div>
  )
}
