import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { TimeEntry, TimeWeek } from '../../../shared/work'
import { callApi, errorMessage } from '../../api'
import { useAuth } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { addDays, addMonths, Badge, Button, ConfirmDialog, ErrorState, Icon, IconButton, LoadingState, Menu, monthNames, Notice, partsOf, useToast, weekdayNames, weekdayOf } from '../../ui'
import { classNames } from '../../ui/classNames'
import { Clock } from '../../work/Clock'
import { formatDay, formatHours, formatWeek, showClock } from '../../work/format'
import { useTimer } from '../../work/timerContext'
import { useShortcuts } from '../../work/useShortcuts'
import { MonthView, PersonPicker } from './MonthView'
import { EntryDialog, type Editing } from './EntryDialog'
import { WeekGrid } from './WeekGrid'
import '../../work/work.css'

const lockWords = { invoiced: 'Invoiced', approved: 'Approved', period: 'Locked' } as const

export function TimePage() {
  const [date, setDate] = useState<string | null>(null)
  const [query, setQuery] = useSearchParams()
  const personId = query.get('person') === null ? null : Number(query.get('person'))
  const route = [date !== null && `date=${date}`, personId !== null && `person=${personId}`].filter(Boolean).join('&')
  const { status, data, error, reload, refresh, setData } = useLoad<TimeWeek>(route === '' ? 'time' : `time?${route}`)
  const { info } = useAuth()
  const approval = info?.company.formats.modules.approval !== false
  const [chosenDay, setDay] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()
  const timer = useTimer()
  const view = query.get('view')
  const weekly = view === 'week'
  const monthly = view === 'month'
  useEffect(() => {
    if (timer.changes > 0) refresh()
  }, [timer.changes, refresh])

  // From the buttons above the navigation.
  const wanted = query.get('new')
  useEffect(() => {
    if (wanted === null || !data) return
    setEditing({ entry: null, date: data.today })
    setQuery({}, { replace: true })
  }, [wanted, data, setQuery])

  const choose = (next: { view?: string | null; person?: string | null }) => {
    const wantedQuery = new URLSearchParams(query)
    for (const [name, value] of Object.entries(next)) {
      if (value) wantedQuery.set(name, value)
      else wantedQuery.delete(name)
    }
    setQuery(wantedQuery, { replace: true })
  }

  const inWeek = (day: string | null) => data !== undefined && day !== null && day >= data.from && day <= data.to
  const day = data ? (inWeek(chosenDay) ? (chosenDay as string) : inWeek(data.today) ? data.today : data.from) : ''
  const show = (next: string) => {
    setDay(next)
    if (!inWeek(next)) setDate(next)
  }
  const minutesOn = (one: string) => (data?.entries ?? []).filter(({ spentOn }) => spentOn === one).reduce((sum, { minutes }) => sum + minutes, 0)
  const total = (data?.entries ?? []).reduce((sum, { minutes }) => sum + minutes, 0)
  const entries = (data?.entries ?? []).filter(({ spentOn }) => spentOn === day)
  const submission = data?.submission ?? null
  const closed = submission !== null && submission.status !== 'rejected'
  const add = () => setEditing({ entry: null, date: day })
  const step = (direction: 1 | -1) => show(monthly ? addMonths(`${day.slice(0, 7)}-01`, direction) : addDays(day, direction * (weekly ? 7 : 1)))
  const goToday = () => {
    setDate(null)
    setDay(data?.today ?? null)
  }
  useShortcuts({ n: add, t: goToday, ArrowLeft: () => step(-1), ArrowRight: () => step(1), d: () => choose({ view: null }), w: () => choose({ view: 'week' }), m: () => choose({ view: 'month' }) }, data !== undefined && editing === null && !submitting)

  const change = async (route: string, body: object, message: string) => {
    try {
      setData(await callApi<TimeWeek>('POST', route, body))
      toast.success(message)
    } catch (reason) {
      toast.error(errorMessage(reason))
    }
  }

  return (
    <Page
      title="Timesheet"
      actions={
        <div className="segments" role="group" aria-label="View">
          <button type="button" aria-pressed={!weekly && !monthly} onClick={() => choose({ view: null })}>
            Day
          </button>
          <button type="button" aria-pressed={weekly} onClick={() => choose({ view: 'week' })}>
            Week
          </button>
          <button type="button" aria-pressed={monthly} onClick={() => choose({ view: 'month' })}>
            Month
          </button>
        </div>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading your time" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="time-bar">
            <Button variant="primary" icon="plus" onClick={add}>
              Track time
            </Button>
            <div className="date-nav">
              <IconButton icon="chevronLeft" label={monthly ? 'Month before' : weekly ? 'Week before' : 'Day before'} onClick={() => step(-1)} />
              <p aria-live="polite">
                <Icon name="calendar" />
                {monthly ? (
                  <span>
                    {monthNames[partsOf(day).month - 1]} {partsOf(day).year}
                  </span>
                ) : weekly ? (
                  <span>{formatWeek(data.from, data.to)}</span>
                ) : (
                  <span>
                    {day === data.today && <span className="muted">Today </span>}
                    {formatDay(day)}
                  </span>
                )}
              </p>
              <IconButton icon="chevronRight" label={monthly ? 'Next month' : weekly ? 'Next week' : 'Next day'} onClick={() => step(1)} />
            </div>
            {(weekly ? !inWeek(data.today) : day !== data.today) && (
              <button
                type="button"
                className="text-button"
                onClick={goToday}
              >
                Return to today
              </button>
            )}
            <PersonPicker week={data} onChoose={(id) => choose({ person: id })} />
          </div>

          {submission?.status === 'rejected' && (
            <Notice tone="warning" title="This week was sent back">
              {submission.comment || 'Change it and submit it again.'}
            </Notice>
          )}

          {monthly ? (
            <MonthView
              month={day.slice(0, 7)}
              today={data.today}
              personId={personId}
              onDay={(one) => {
                show(one)
                choose({ view: null })
              }}
            />
          ) : weekly ? (
            <WeekGrid key={data.from} week={data} onChange={setData} onAdd={add} onReload={reload} />
          ) : (
            <>
              <div className="day-strip" role="group" aria-label="Day">
                {Array.from({ length: 7 }, (_, index) => addDays(data.from, index)).map((one) => (
                  <button
                    key={one}
                    type="button"
                    className={classNames('day-tab', one === data.today && 'is-now')}
                    aria-pressed={one === day}
                    aria-current={one === data.today ? 'date' : undefined}
                    onClick={() => setDay(one)}
                  >
                    <span>{weekdayNames[weekdayOf(one)].slice(0, 3)}</span> <span className="day-tab-hours">{formatHours(minutesOn(one))}</span>
                  </button>
                ))}
                <p className="day-total">
                  <span>Week total</span> <span className="figure">{formatHours(total)}</span>
                </p>
              </div>
              {entries.length === 0 ? (
                <div className="day-empty">
                  <p>Nothing tracked on this day.</p>
                  {!closed && (
                    <button type="button" className="text-button" onClick={add}>
                      <Icon name="plus" /> Track time
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <ul className="entries">
                    {entries.map((entry) => (
                      <Entry key={entry.id} entry={entry} today={data.today} own={data.own} onEdit={() => setEditing({ entry, date: entry.spentOn })} />
                    ))}
                  </ul>
                  <div className="entries-foot">
                    {closed ? (
                      <span />
                    ) : (
                      <button type="button" className="text-button" onClick={add}>
                        <Icon name="plus" /> Track time
                      </button>
                    )}
                    <p>
                      Total: <strong className="figure">{formatHours(minutesOn(day))}</strong>
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="time-foot">
            {closed || weekly || monthly || !data.own ? (
              <span />
            ) : (
              <Menu
                label="Copy from previous day"
                items={[
                  { id: 'rows', label: 'Projects and tasks only', onSelect: () => void change('time/copy', { date: day, withHours: false }, 'Copied') },
                  { id: 'all', label: 'With hours and notes', onSelect: () => void change('time/copy', { date: day, withHours: true }, 'Copied') },
                ]}
              />
            )}
            {submission?.status === 'approved' && <Badge tone="success">Week approved</Badge>}
            {submission?.status === 'submitted' && (
              <span className="time-state">
                <Badge tone="info">Waiting for approval</Badge>
                {data.own && <Button onClick={() => void change('time/withdraw', { date: data.from }, 'Week taken back')}>Take back</Button>}
              </span>
            )}
            {!closed && data.own && approval && !monthly && (
              <Button aria-disabled={total === 0 || undefined} onClick={() => total > 0 && setSubmitting(true)}>
                Submit week for approval
              </Button>
            )}
          </div>

          <ConfirmDialog
            open={submitting}
            onClose={() => setSubmitting(false)}
            title="Submit this week?"
            message={`${formatWeek(data.from, data.to)}: ${formatHours(total)} hours. You cannot change the week while it waits for approval, but you can take it back.`}
            confirmLabel="Submit week"
            onConfirm={async () => {
              try {
                setData(await callApi<TimeWeek>('POST', 'time/submit', { date: data.from }))
                toast.success('Week submitted')
              } catch (reason) {
                throw new Error(errorMessage(reason), { cause: reason })
              }
            }}
          />
          {editing && (
            <EntryDialog
              editing={editing}
              today={data.today}
              personId={data.own ? null : data.person.id}
              onClose={() => setEditing(null)}
              onSaved={(week, message) => {
                setEditing(null)
                if (week.from !== data.from) setDate(week.from)
                setDay(null)
                setData(week)
                timer.refresh()
                toast.success(message)
              }}
              onDay={setDay}
              onDeleted={() => {
                setEditing(null)
                timer.refresh()
                refresh()
                toast.success('Entry deleted')
              }}
              onReload={reload}
            />
          )}
        </>
      )}
    </Page>
  )
}

function Entry({ entry, today, own, onEdit }: { entry: TimeEntry; today: string; own: boolean; onEdit: () => void }) {
  const { running, start, again, stop } = useTimer()
  const isRunning = entry.timerStartedAt !== null || running?.id === entry.id
  const what = `${entry.task}, ${entry.project}`
  const begin = () => void (entry.spentOn === today ? start(entry) : again(entry))
  return (
    <li className={classNames('entry', isRunning && 'is-running')}>
      <div className="entry-text">
        <p>
          <span className="strong">
            {entry.projectCode && `[${entry.projectCode}] `}
            {entry.project}
          </span>{' '}
          ({entry.client})
        </p>
        <p>
          {entry.task}
          {entry.startMinute !== null && entry.endMinute !== null && (
            <span className="muted">
              , {showClock(entry.startMinute)} to {showClock(entry.endMinute)}
            </span>
          )}
        </p>
        {entry.notes && <p className="muted">{entry.notes}</p>}
      </div>
      {entry.locked && (
        <span className="entry-state">
          <Icon name="lock" /> {lockWords[entry.locked]}
        </span>
      )}
      <p className="entry-time">{isRunning ? <Clock entry={running ?? entry} /> : formatHours(entry.minutes)}</p>
      {!entry.locked && (
        <div className="entry-actions">
          {isRunning && own ? (
            <Button icon="stop" variant="primary" aria-label={`Stop timer for ${what}`} onClick={() => void stop()}>
              Stop
            </Button>
          ) : (
            <>
              {own && <Button icon="time" aria-label={`Start timer for ${what}`} onClick={begin}>
                Start
              </Button>}
              {/* A running entry is changed once it is stopped. */}
              <Button size="small" aria-label={`Edit ${what}`} onClick={onEdit}>
                Edit
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  )
}
