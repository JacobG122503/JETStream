import { useRef, useState } from 'react'
import type { TimeEntry, TimeWeek } from '../../../shared/work'
import { callApi, errorMessage } from '../../api'
import { addDays, Icon, partsOf, useToast, weekdayNames, weekdayOf } from '../../ui'
import { classNames } from '../../ui/classNames'
import { formatDay, formatHours, hoursInput, parseHours } from '../../work/format'

interface WeekGridProps {
  week: TimeWeek
  onChange: (week: TimeWeek) => void
  onAdd: () => void
  onReload: () => void
}

const sum = (entries: readonly TimeEntry[]) => entries.reduce((total, { minutes }) => total + minutes, 0)

/** The week as rows of projects and tasks, to type hours into. */
export function WeekGrid({ week, onChange, onAdd, onReload }: WeekGridProps) {
  const toast = useToast()
  /** One change after another, so that each is made on what the one before it left. */
  const queue = useRef<Promise<void>>(Promise.resolve())
  const days = Array.from({ length: 7 }, (_, index) => addDays(week.from, index))
  const closed = week.submission !== null && week.submission.status !== 'rejected'
  const rows = new Map<string, TimeEntry[]>()
  for (const entry of week.entries) {
    const key = `${entry.projectId}/${entry.taskId}`
    rows.set(key, [...(rows.get(key) ?? []), entry])
  }

  const save = (row: TimeEntry, day: string, entry: TimeEntry | undefined, minutes: number) => {
    queue.current = queue.current.then(async () => {
      try {
        const body = { projectId: row.projectId, taskId: row.taskId, spentOn: day, minutes, notes: entry?.notes ?? '' }
        onChange(entry ? await callApi<TimeWeek>('PUT', `time/${entry.id}`, { ...body, version: entry.version }) : await callApi<TimeWeek>('POST', 'time', body))
      } catch (reason) {
        toast.error(errorMessage(reason))
        onReload()
      }
    })
  }

  return (
    <div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Timesheet of the week">
        <table className="week-grid">
          <thead>
            <tr>
              <th scope="col">Project and task</th>
              {days.map((day) => (
                <th key={day} scope="col" className={classNames(day === week.today && 'is-now')}>
                  {weekdayNames[weekdayOf(day)].slice(0, 3)}
                  <span>{partsOf(day).day}</span>
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.size === 0 && (
              <tr>
                <td colSpan={9} className="week-none">
                  Nothing tracked in this week.
                </td>
              </tr>
            )}
            {[...rows].map(([key, entries]) => {
              const [row] = entries as [TimeEntry, ...TimeEntry[]]
              return (
                <tr key={key}>
                  <th scope="row">
                    <span className="strong">
                      {row.projectCode && `[${row.projectCode}] `}
                      {row.project}
                    </span>{' '}
                    <span className="week-client">({row.client})</span>
                    <span className="week-task">{row.task}</span>
                  </th>
                  {days.map((day) => {
                    const there = entries.filter(({ spentOn }) => spentOn === day)
                    const [entry] = there
                    const editable = !closed && there.length <= 1 && (!entry || (entry.locked === null && entry.timerStartedAt === null))
                    return (
                      <td key={day}>
                        {editable ? (
                          <Cell
                            key={entry ? `${entry.id}/${entry.version}` : 'none'}
                            label={`${row.task}, ${row.project}, ${formatDay(day)}`}
                            minutes={entry?.minutes ?? 0}
                            onSave={(minutes) => save(row, day, entry, minutes)}
                          />
                        ) : (
                          <span className="week-fixed">{there.length > 0 ? formatHours(sum(there)) : ''}</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="week-sum">{formatHours(sum(entries))}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>
                {!closed && (
                  <button type="button" className="text-button" onClick={onAdd}>
                    <Icon name="plus" /> Add row
                  </button>
                )}
              </td>
              {days.map((day) => (
                <td key={day}>{formatHours(sum(week.entries.filter(({ spentOn }) => spentOn === day)))}</td>
              ))}
              <td className="week-sum">{formatHours(sum(week.entries))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function Cell({ label, minutes, onSave }: { label: string; minutes: number; onSave: (minutes: number) => void }) {
  const shown = minutes > 0 ? hoursInput(minutes) : ''
  const [text, setText] = useState(shown)
  const parsed = text.trim() === '' ? 0 : parseHours(text)
  const wrong = parsed === null || parsed > 1440
  const leave = () => {
    if (wrong || parsed === null) return
    if (parsed !== minutes) onSave(parsed)
    else setText(shown)
  }
  return (
    <input
      className="control week-cell"
      aria-label={label}
      aria-invalid={wrong || undefined}
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={leave}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setText(shown)
      }}
    />
  )
}
