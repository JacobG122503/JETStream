import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { IconButton } from './Button'
import { classNames } from './classNames'
import {
  addDays, addMonths, clampDate, formatLongDate, isIsoDate, type IsoDate, monthGrid, monthNames, partsOf, startOfWeek, type Weekday, weekdayNames,
} from './dates'

interface CalendarProps {
  value: IsoDate
  min?: IsoDate
  max?: IsoDate
  today: IsoDate
  weekStart: Weekday
  onPick: (date: IsoDate) => void
}

/** One month of days. Takes focus when it appears. */
export function Calendar({ value, min, max, today, weekStart, onPick }: CalendarProps) {
  const [focused, setFocused] = useState(() => clampDate(isIsoDate(value) ? value : today, min, max))
  const grid = useRef<HTMLTableElement>(null)
  /** Whether focus follows `focused`: for keys, but not for the month buttons. */
  const moveFocus = useRef(true)
  const titleId = useId()
  const { year, month } = partsOf(focused)
  const title = `${monthNames[month - 1]} ${year}`

  useEffect(() => {
    if (moveFocus.current) grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true })
    moveFocus.current = false
  }, [focused])

  const go = (date: IsoDate, withFocus: boolean) => {
    moveFocus.current = withFocus
    if (isIsoDate(date)) setFocused(clampDate(date, min, max))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const weekBegin = startOfWeek(focused, weekStart)
    const targets: Record<string, () => IsoDate> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => weekBegin,
      End: () => addDays(weekBegin, 6),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
    }
    const target = targets[event.key]
    if (!target) return
    event.preventDefault()
    go(target(), true)
  }

  // A month is out of reach when none of its days are inside min and max.
  const firstDay = `${focused.slice(0, 8)}01`
  const canGo = (months: number) => {
    const begin = addMonths(firstDay, months)
    const end = addDays(addMonths(begin, 1), -1)
    return isIsoDate(begin) && !(min && end < min) && !(max && begin > max)
  }
  const monthButton = (icon: 'chevronsLeft' | 'chevronLeft' | 'chevronRight' | 'chevronsRight', label: string, months: number) => (
    <IconButton
      icon={icon}
      size="small"
      label={label}
      aria-disabled={!canGo(months) || undefined}
      onClick={() => go(addMonths(focused, months), false)}
    />
  )

  return (
    <div className="calendar">
      <div className="calendar-header">
        {monthButton('chevronsLeft', 'Previous year', -12)}
        {monthButton('chevronLeft', 'Previous month', -1)}
        <p id={titleId} className="calendar-title" aria-live="polite">
          {title}
        </p>
        {monthButton('chevronRight', 'Next month', 1)}
        {monthButton('chevronsRight', 'Next year', 12)}
      </div>
      <table ref={grid} role="grid" className="calendar-grid" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {weekdayNames.map((_, offset) => {
              const name = weekdayNames[(weekStart + offset) % 7] ?? ''
              return (
                <th key={name} scope="col">
                  <span aria-hidden="true">{name.slice(0, 2)}</span>
                  <span className="sr-only">{name}</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {monthGrid(year, month, weekStart).map((week, row) => (
            <tr key={row}>
              {week.map((date, column) =>
                date === null ? (
                  <td key={column} />
                ) : (
                  <td key={column} role="gridcell" aria-selected={date === value}>
                    <button
                      type="button"
                      className={classNames('day', date === value && 'is-selected', date === today && 'is-today')}
                      tabIndex={date === focused ? 0 : -1}
                      aria-label={`${formatLongDate(date)}${date === today ? ', today' : ''}${date === value ? ', selected' : ''}`}
                      aria-current={date === today ? 'date' : undefined}
                      disabled={date !== clampDate(date, min, max)}
                      onClick={() => onPick(date)}
                    >
                      {partsOf(date).day}
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
