import { type FormEvent, useEffect, useId, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { TimeEntry, TimeProject, TimeWeek } from '../../../shared/work'
import { callApi, errorMessage } from '../../api'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { addDays, Badge, Button, Combobox, ConfirmDialog, DatePicker, Dialog, EmptyState, ErrorState, formatDate, formatLongDate, Icon, IconButton, LoadingState, Meter, Notice, partsOf, Select, Tabs, TextArea, TextField, useToast, weekdayNames, weekdayOf } from '../../ui'
import { classNames } from '../../ui/classNames'
import { Clock } from '../../work/Clock'
import { formatHours, parseHours, percentOf } from '../../work/format'
import { useTimer } from '../../work/timerContext'
import '../../work/work.css'

type Editing = { entry: TimeEntry | null; date: string }

const lockWords = { invoiced: 'Invoiced', approved: 'Approved', period: 'Handed in' } as const

export function TimePage() {
  const [query, setQuery] = useSearchParams()
  const [date, setDate] = useState<string | null>(null)
  const { status, data, error, reload, refresh, setData } = useLoad<TimeWeek>(date === null ? 'time' : `time?date=${date}`)
  const [chosenDay, setDay] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [deleting, setDeleting] = useState<TimeEntry | null>(null)
  const toast = useToast()
  const timer = useTimer()
  useEffect(() => {
    if (timer.changes > 0) refresh()
  }, [timer.changes, refresh])

  // From the link on the home page.
  const wantsNew = query.get('new') !== null
  useEffect(() => {
    if (!wantsNew || !data) return
    setEditing({ entry: null, date: data.today })
    setQuery({}, { replace: true })
  }, [wantsNew, data, setQuery])

  const inWeek = (day: string | null) => data !== undefined && day !== null && day >= data.from && day <= data.to
  const day = data ? (inWeek(chosenDay) ? (chosenDay as string) : inWeek(data.today) ? data.today : data.from) : ''
  const go = (days: number) => {
    if (!data) return
    setDate(addDays(data.from, days))
    setDay(addDays(day, days))
  }
  const minutesOn = (wanted: string) => (data?.entries ?? []).filter(({ spentOn }) => spentOn === wanted).reduce((sum, { minutes }) => sum + minutes, 0)
  const total = (data?.entries ?? []).reduce((sum, { minutes }) => sum + minutes, 0)
  const entries = (data?.entries ?? []).filter(({ spentOn }) => spentOn === day)

  return (
    <Page
      title="Time"
      actions={
        <Button variant="primary" icon="plus" aria-disabled={!data || undefined} onClick={() => setEditing({ entry: null, date: day })}>
          Track time
        </Button>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading your time" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="week-head">
            <div className="week-nav">
              <IconButton icon="chevronLeft" label="Week before" onClick={() => go(-7)} />
              <p className="week-range" aria-live="polite">
                {formatDate(data.from)} to {formatDate(data.to)}
              </p>
              <IconButton icon="chevronRight" label="Next week" onClick={() => go(7)} />
              {!inWeek(data.today) && (
                <Button
                  size="small"
                  onClick={() => {
                    setDate(null)
                    setDay(data.today)
                  }}
                >
                  This week
                </Button>
              )}
            </div>
            <div className="week-total">
              <span>
                <strong className="figure">{formatHours(total)}</strong> <span className="muted">of {formatHours(data.capacityMinutes)}</span>
              </span>
              <Meter percent={percentOf(total, data.capacityMinutes)} />
            </div>
          </div>

          <Tabs
            label="View"
            items={[
              {
                id: 'day',
                label: 'Day',
                content: (
                  <div className="stack">
                    <div className="days" role="group" aria-label="Day">
                      {Array.from({ length: 7 }, (_, index) => addDays(data.from, index)).map((one) => (
                        <button
                          key={one}
                          type="button"
                          className={classNames('day', one === data.today && 'is-today')}
                          aria-pressed={one === day}
                          aria-label={`${formatLongDate(one)}, ${formatHours(minutesOn(one))}`}
                          onClick={() => setDay(one)}
                        >
                          <span className="day-name">{weekdayNames[weekdayOf(one)].slice(0, 3)}</span>
                          <span className="day-number">{partsOf(one).day}</span>
                          <span className="day-hours">{minutesOn(one) > 0 ? formatHours(minutesOn(one)) : '-'}</span>
                        </button>
                      ))}
                    </div>
                    <h2 className="section-title">{formatLongDate(day)}</h2>
                    {entries.length === 0 ? (
                      <div className="panel-empty">
                        <EmptyState
                          icon="time"
                          headingLevel={3}
                          title="Nothing tracked on this day"
                          description="Add what you worked on, or start a timer."
                          action={
                            <Button icon="plus" onClick={() => setEditing({ entry: null, date: day })}>
                              Track time
                            </Button>
                          }
                        />
                      </div>
                    ) : (
                      <ul className="entries">
                        {entries.map((entry) => (
                          <Entry key={entry.id} entry={entry} today={data.today} onEdit={() => setEditing({ entry, date: entry.spentOn })} onDelete={() => setDeleting(entry)} />
                        ))}
                      </ul>
                    )}
                  </div>
                ),
              },
              { id: 'week', label: 'Week', content: <WeekTable week={data} /> },
            ]}
          />
          {editing && (
            <EntryDialog
              editing={editing}
              today={data.today}
              onClose={() => setEditing(null)}
              onSaved={(week, message) => {
                setEditing(null)
                setDate(week.from)
                setDay(null)
                setData(week)
                timer.refresh()
                toast.success(message)
              }}
              onDay={setDay}
              onReload={reload}
            />
          )}
          <ConfirmDialog
            open={deleting !== null}
            onClose={() => setDeleting(null)}
            title="Delete this entry?"
            message={deleting && `${formatHours(deleting.minutes)} on ${deleting.task}, ${deleting.project}.`}
            confirmLabel="Delete entry"
            destructive
            onConfirm={async () => {
              if (!deleting) return
              try {
                await callApi('POST', `time/${deleting.id}/delete`, { version: deleting.version })
                toast.success('Entry deleted')
                timer.refresh()
                refresh()
              } catch (reason) {
                throw new Error(errorMessage(reason), { cause: reason })
              }
            }}
          />
        </>
      )}
    </Page>
  )
}

interface EntryProps {
  entry: TimeEntry
  today: string
  onEdit: () => void
  onDelete: () => void
}

function Entry({ entry, today, onEdit, onDelete }: EntryProps) {
  const { running, start, stop } = useTimer()
  const isRunning = entry.timerStartedAt !== null || running?.id === entry.id
  const what = `${entry.task}, ${entry.project}`
  return (
    <li className={classNames('entry', isRunning && 'is-running')}>
      <div className="entry-text">
        <p className="entry-title">
          <span className="strong">{entry.project}</span> <span className="muted">{entry.client}</span>
        </p>
        <p>
          {entry.task}
          {entry.billable && <span className="billable-dot" role="img" aria-label="Billable" title="Billable" />}
        </p>
        {entry.notes && <p className="muted">{entry.notes}</p>}
      </div>
      {entry.locked && (
        <Badge>
          {lockWords[entry.locked]}
        </Badge>
      )}
      {entry.status === 'rejected' && <Badge tone="warning">Sent back</Badge>}
      <p className="entry-time">{isRunning ? <Clock entry={running ?? entry} /> : formatHours(entry.minutes)}</p>
      <div className="entry-actions">
        {!entry.locked &&
          (isRunning ? (
            <Button icon="stop" variant="primary" size="small" aria-label={`Stop timer for ${what}`} onClick={() => void stop()}>
              Stop
            </Button>
          ) : (
            entry.spentOn === today && (
              <Button icon="play" size="small" aria-label={`Start timer for ${what}`} onClick={() => void start(entry)}>
                Start
              </Button>
            )
          ))}
        {entry.locked ? (
          <span className="entry-lock" aria-hidden="true">
            <Icon name="lock" />
          </span>
        ) : (
          <>
            <IconButton icon="edit" size="small" variant="quiet" label={`Edit ${what}`} onClick={onEdit} />
            <IconButton icon="trash" size="small" variant="quiet" label={`Delete ${what}`} onClick={onDelete} />
          </>
        )}
      </div>
    </li>
  )
}

function WeekTable({ week }: { week: TimeWeek }) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(week.from, index))
  const rows = new Map<string, TimeEntry[]>()
  for (const entry of week.entries) {
    const key = `${entry.projectId}/${entry.taskId}`
    rows.set(key, [...(rows.get(key) ?? []), entry])
  }
  const sum = (entries: TimeEntry[]) => entries.reduce((total, { minutes }) => total + minutes, 0)
  if (rows.size === 0) return <Notice>Nothing tracked in this week.</Notice>
  return (
    <div className="table-box">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Timesheet of the week">
        <table className="table week-table">
          <thead>
            <tr>
              <th scope="col">Project and task</th>
              {days.map((day) => (
                <th key={day} scope="col" className="is-numeric">
                  <span className={classNames(day === week.today && 'strong')}>
                    {weekdayNames[weekdayOf(day)].slice(0, 3)} {partsOf(day).day}
                  </span>
                </th>
              ))}
              <th scope="col" className="is-numeric">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {[...rows].map(([key, entries]) => (
              <tr key={key}>
                <th scope="row" className="week-row">
                  <span className="strong">{entries[0]?.project}</span>
                  <span className="muted">{entries[0]?.task}</span>
                </th>
                {days.map((day) => {
                  const minutes = sum(entries.filter(({ spentOn }) => spentOn === day))
                  return (
                    <td key={day} className="is-numeric">
                      {minutes > 0 ? formatHours(minutes) : <span className="muted">-</span>}
                    </td>
                  )
                })}
                <td className="is-numeric strong">{formatHours(sum(entries))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {days.map((day) => (
                <td key={day} className="is-numeric">
                  {formatHours(sum(week.entries.filter(({ spentOn }) => spentOn === day)))}
                </td>
              ))}
              <td className="is-numeric">{formatHours(sum(week.entries))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

const fields = ['projectId', 'taskId', 'spentOn', 'minutes', 'notes'] as const

interface EntryDialogProps {
  editing: Editing
  today: string
  onClose: () => void
  onSaved: (week: TimeWeek, message: string) => void
  onDay: (day: string) => void
  onReload: () => void
}

function EntryDialog({ editing: { entry, date }, today, onClose, onSaved, onDay, onReload }: EntryDialogProps) {
  const formId = useId()
  const { status, data, error, reload } = useLoad<{ projects: TimeProject[] }>('time/options')
  const [projectId, setProjectId] = useState<string | null>(entry ? String(entry.projectId) : null)
  const [taskId, setTaskId] = useState(entry ? String(entry.taskId) : '')
  const [spentOn, setSpentOn] = useState(date)
  const [hours, setHours] = useState(entry && entry.minutes > 0 ? formatHours(entry.minutes) : '')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const form = useForm('entry', fields)
  const project = data?.projects.find(({ id }) => String(id) === projectId)
  const minutes = hours.trim() === '' ? 0 : parseHours(hours)
  const startsTimer = !entry && minutes === 0 && spentOn === today

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        const body = { projectId: Number(projectId), taskId: Number(taskId), spentOn, minutes, notes }
        const week = entry
          ? await callApi<TimeWeek>('PUT', `time/${entry.id}`, { ...body, version: entry.version })
          : await callApi<TimeWeek>('POST', 'time', { ...body, start: startsTimer })
        onSaved(week, entry ? 'Entry saved' : startsTimer ? 'Timer started' : 'Time added')
        onDay(spentOn)
      },
      {
        projectId: projectId === null ? 'Choose a project.' : null,
        taskId: taskId === '' ? 'Choose a task.' : null,
        spentOn: spentOn === '' ? 'Enter a date.' : null,
        minutes: minutes === null ? 'Enter a time such as 1:30 or 1.5.' : !entry && minutes === 0 && !startsTimer ? 'Enter a time. A timer can only be started today.' : null,
      },
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry ? 'Edit entry' : 'Track time'}
      closeOnOutsidePress={false}
      busy={form.busy}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" icon={startsTimer ? 'play' : undefined} loading={form.busy} loadingLabel="Saving" aria-disabled={!data || undefined}>
            {entry ? 'Save entry' : startsTimer ? 'Start timer' : 'Add time'}
          </Button>
        </>
      }
    >
      {status === 'loading' && <LoadingState label="Loading projects" />}
      {status === 'error' && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <form id={formId} className="stack" noValidate onSubmit={submit}>
          <FormMessages form={form} onReload={onReload} />
          {data.projects.length === 0 && <Notice>You are not on any project yet. Ask an administrator to assign you.</Notice>}
          <Combobox
            label="Project"
            required
            placeholder="Search projects"
            value={projectId}
            options={data.projects.map(({ id, name, client }) => ({ value: String(id), label: name, group: client }))}
            onChange={(value) => {
              setProjectId(value)
              const tasks = data.projects.find(({ id }) => String(id) === value)?.tasks ?? []
              setTaskId(tasks.some(({ id }) => String(id) === taskId) ? taskId : String(tasks[0]?.id ?? ''))
            }}
            {...form.field('projectId')}
          />
          <Select
            label="Task"
            required
            placeholder={project ? 'Choose a task' : 'Choose a project first'}
            disabled={!project}
            value={taskId}
            options={(project?.tasks ?? []).map(({ id, name, billable }) => ({ value: String(id), label: billable ? name : `${name} (not billable)` }))}
            onChange={setTaskId}
            {...form.field('taskId')}
          />
          <div className="form-pair">
            <DatePicker label="Date" required value={spentOn} onChange={setSpentOn} today={today} {...form.field('spentOn')} />
            <TextField
              label="Hours"
              placeholder="0:00"
              autoComplete="off"
              inputMode="decimal"
              hint={entry ? undefined : 'Leave empty to start a timer. 1:30, 1.5 and 90m all work.'}
              value={hours}
              onChange={setHours}
              {...form.field('minutes')}
            />
          </div>
          <TextArea label="Notes" rows={3} value={notes} onChange={setNotes} {...form.field('notes')} />
        </form>
      )}
    </Dialog>
  )
}
