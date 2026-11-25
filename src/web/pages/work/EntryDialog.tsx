import { type FormEvent, useId, useState } from 'react'
import type { TimeEntry, TimeProject, TimeWeek } from '../../../shared/work'
import { callApi, errorMessage } from '../../api'
import { useWeekStart } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Button, Combobox, ConfirmDialog, DatePicker, Dialog, ErrorState, LoadingState, Notice, Select, TextArea, TextField } from '../../ui'
import { formatHours, hoursInput, parseHours } from '../../work/format'

/** What is entered: something new on a date, or an entry there is. */
export interface Editing {
  entry: TimeEntry | null
  date: string
}

const fields = ['projectId', 'taskId', 'spentOn', 'minutes', 'notes'] as const

interface EntryDialogProps {
  editing: Editing
  today: string
  onClose: () => void
  onSaved: (week: TimeWeek, message: string) => void
  onDay: (day: string) => void
  onDeleted: () => void
  onReload: () => void
}

export function EntryDialog({ editing: { entry, date }, today, onClose, onSaved, onDay, onDeleted, onReload }: EntryDialogProps) {
  const weekStart = useWeekStart()
  const formId = useId()
  const { status, data, error, reload } = useLoad<{ projects: TimeProject[] }>('time/options')
  const [projectId, setProjectId] = useState<string | null>(entry ? String(entry.projectId) : null)
  const [taskId, setTaskId] = useState(entry ? String(entry.taskId) : '')
  const [spentOn, setSpentOn] = useState(date)
  const [hours, setHours] = useState(entry && entry.minutes > 0 ? hoursInput(entry.minutes) : '')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [deleting, setDeleting] = useState(false)
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
        minutes: minutes === null ? 'Enter hours such as 1.5 or 6.25.' : !entry && minutes === 0 && !startsTimer ? 'Enter hours. A timer can only be started today.' : null,
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
            <TextField
              label="Hours"
              placeholder="0.00"
              autoComplete="off"
              inputMode="decimal"
              hint={entry ? undefined : 'Leave empty to start a timer.'}
              value={hours}
              onChange={setHours}
              {...form.field('minutes')}
            />
          </div>
          <TextArea label="Notes" rows={3} value={notes} onChange={setNotes} {...form.field('notes')} />
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
