import { type FormEvent, useId, useState } from 'react'
import type { TimeEntry, TimeOptions, TimeWeek } from '../../../shared/work'
import { callApi, errorMessage } from '../../api'
import { useWeekStart } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Button, Combobox, ConfirmDialog, DatePicker, Dialog, ErrorState, IconButton, LoadingState, Notice, Select, TextArea, TextField } from '../../ui'
import { formatHours, getFormats, hoursInput, parseClock, parseHours, showClock } from '../../work/format'
import { useActions } from '../../work/useActions'

/** What is entered: something new on a date, or an entry there is. */
export interface Editing {
  entry: TimeEntry | null
  date: string
}

const fields = ['projectId', 'taskId', 'spentOn', 'minutes', 'startMinute', 'endMinute', 'notes'] as const

interface EntryDialogProps {
  editing: Editing
  today: string
  /** Someone else whose time it is. */
  personId: number | null
  onClose: () => void
  onSaved: (week: TimeWeek, message: string) => void
  onDay: (day: string) => void
  onDeleted: () => void
  onReload: () => void
}

export function EntryDialog({ editing: { entry, date }, today, personId, onClose, onSaved, onDay, onDeleted, onReload }: EntryDialogProps) {
  const weekStart = useWeekStart()
  const formId = useId()
  const { run } = useActions()
  const { status, data, error, reload, setData } = useLoad<TimeOptions>(personId === null ? 'time/options' : `time/options?person=${personId}`)
  const [projectId, setProjectId] = useState<string | null>(entry ? String(entry.projectId) : null)
  const [taskId, setTaskId] = useState(entry ? String(entry.taskId) : '')
  const [spentOn, setSpentOn] = useState(date)
  const [hours, setHours] = useState(entry && entry.minutes > 0 ? hoursInput(entry.minutes) : '')
  const [from, setFrom] = useState(entry && entry.startMinute !== null ? showClock(entry.startMinute) : '')
  const [until, setUntil] = useState(entry && entry.endMinute !== null ? showClock(entry.endMinute) : '')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [deleting, setDeleting] = useState(false)
  const form = useForm('entry', fields)
  const project = data?.projects.find(({ id }) => String(id) === projectId)
  // Time that was entered as hours stays so.
  const clock = getFormats().timeMode === 'start_end' && (!entry || entry.startMinute !== null || entry.minutes === 0)
  const start = parseClock(from)
  const end = parseClock(until)
  const typed = clock ? from.trim() !== '' || until.trim() !== '' : hours.trim() !== ''
  const minutes = !typed ? 0 : clock ? (start === null || end === null ? null : end - start) : parseHours(hours)
  const startsTimer = !entry && minutes === 0 && spentOn === today && personId === null
  const favorites = (data?.favorites ?? []).flatMap((favorite) => {
    const on = data?.projects.find(({ id }) => id === favorite.projectId)
    const task = on?.tasks.find(({ id }) => id === favorite.taskId)
    return on && task ? [{ ...favorite, label: `${task.name}, ${on.name}` }] : []
  })
  const isFavorite = favorites.some((one) => String(one.projectId) === projectId && String(one.taskId) === taskId)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        const body = { projectId: Number(projectId), taskId: Number(taskId), spentOn, minutes, notes, personId, startMinute: clock && typed ? start : null, endMinute: clock && typed ? end : null }
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
        startMinute: clock && typed && start === null ? 'Enter a time such as 8:30 am.' : null,
        endMinute: clock && typed ? (end === null ? 'Enter a time such as 4:15 pm.' : start !== null && end < start ? 'The end is before the start.' : null) : null,
        notes: data?.notesRequired && !startsTimer && notes.trim() === '' ? 'Enter notes.' : null,
        minutes: clock && typed ? null : minutes === null ? 'Enter hours such as 1.5 or 6.25.' : !entry && minutes === 0 && !startsTimer ? 'Enter hours. A timer can only be started today.' : null,
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
          {entry && (
            <Button className="dialog-delete" icon="trash" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" icon={startsTimer ? 'timer' : undefined} loading={form.busy} loadingLabel="Saving" aria-disabled={!data || undefined}>
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
          {!entry && personId === null && favorites.length > 0 && (
            <div className="favorites" role="group" aria-label="Favorites">
              {favorites.map(({ id, projectId: onProject, taskId: onTask, label }) => (
                <span key={id} className="favorite">
                  <Button
                    size="small"
                    aria-pressed={String(onProject) === projectId && String(onTask) === taskId}
                    onClick={() => {
                      setProjectId(String(onProject))
                      setTaskId(String(onTask))
                    }}
                  >
                    {label}
                  </Button>
                  <IconButton size="small" variant="quiet" icon="close" label={`Remove ${label} from favorites`} onClick={() => void run('DELETE', `time/favorites/${id}`, undefined, '', setData)} />
                </span>
              ))}
            </div>
          )}
          <Combobox
            label="Project"
            required
            placeholder="Search projects"
            value={projectId}
            options={data.projects.map(({ id, name, code, client }) => ({ value: String(id), label: code ? `[${code}] ${name}` : name, group: client }))}
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
            <DatePicker weekStart={weekStart} label="Date" required value={spentOn} onChange={setSpentOn} today={today} {...form.field('spentOn')} />
            {!clock && <TextField
              label="Hours"
              placeholder="0.00"
              autoComplete="off"
              inputMode="decimal"
              hint={entry || personId !== null ? undefined : 'Leave empty to start a timer.'}
              value={hours}
              onChange={setHours}
              {...form.field('minutes')}
            />}
          </div>
          {clock && (
            <div className="form-pair">
              <TextField label="Start" placeholder="8:30 am" autoComplete="off" hint={entry || personId !== null ? undefined : 'Leave empty to start a timer.'} value={from} onChange={setFrom} {...form.field('startMinute')} />
              <TextField label="End" placeholder="4:15 pm" autoComplete="off" hint={minutes !== null && minutes > 0 ? `${formatHours(minutes)} hours` : undefined} value={until} onChange={setUntil} {...form.field('endMinute')} />
            </div>
          )}
          <TextArea label="Notes" rows={3} required={data.notesRequired} value={notes} onChange={setNotes} {...form.field('notes')} />
          {personId === null && project && taskId !== '' && !isFavorite && (
            <Button size="small" variant="quiet" icon="star" onClick={() => void run('POST', 'time/favorites', { projectId: Number(projectId), taskId: Number(taskId), notes: '' }, 'Added to your favorites', setData)}>
              Add to favorites
            </Button>
          )}
        </form>
      )}
      {entry && (
        <ConfirmDialog
          open={deleting}
          onClose={() => setDeleting(false)}
          title="Delete this entry?"
          message={`${formatHours(entry.minutes)} hours on ${entry.task}, ${entry.project}.`}
          confirmLabel="Delete entry"
          destructive
          onConfirm={async () => {
            try {
              await callApi('POST', `time/${entry.id}/delete`, { version: entry.version })
              onDeleted()
            } catch (reason) {
              throw new Error(errorMessage(reason), { cause: reason })
            }
          }}
        />
      )}
    </Dialog>
  )
}
