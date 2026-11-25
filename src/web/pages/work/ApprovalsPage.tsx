import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { type ApprovalGroup, type ApprovalRow, approvalView, lockState } from '../../../shared/approvals'
import type { Approvals, ApprovalStatus, ApprovalWeek } from '../../../shared/work'
import { callApi } from '../../api'
import { useCan } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { photoUrl } from '../../shell/photo'
import { Page } from '../../shell/Page'
import {
  addDays, Avatar, Button, Checkbox, EmptyState, ErrorState, FilterMenu, formatDate, Icon, LinkButton, LoadingState, Menu, Notice, startOfWeek, useToast, weekdayNames,
} from '../../ui'
import { FormDialog } from '../../work/FormDialog'
import { formatAmounts, formatDay, formatHours, formatMoney, formatWeek, percentOf, showClock } from '../../work/format'
import { PeriodBar, usePeriod } from '../../work/Period'
import { useQuery } from '../../work/query'
import { ShareBar } from '../../work/ShareBar'
import { type Action, useActions } from '../../work/useActions'
import '../../work/work.css'
import './approvals.css'

const statusLabels: Record<ApprovalStatus, string> = { open: 'Unsubmitted', submitted: 'Pending Approval', approved: 'Approved' }
const groupLabels: Record<ApprovalGroup, string> = { person: 'Person', project: 'Project', client: 'Client' }
const statuses = Object.keys(statusLabels) as ApprovalStatus[]
const groups = Object.keys(groupLabels) as ApprovalGroup[]

export function ApprovalsPage() {
  const period = usePeriod('week')
  const { start, end } = period.range
  const { get, change } = useQuery()
  const status = statuses.find((known) => known === get('status')) ?? 'open'
  const group = groups.find((known) => known === get('group')) ?? 'person'
  const load = useLoad<Approvals>(`approvals?from=${start}&to=${end}`)
  // Not what was loaded for another period.
  const data = load.data?.from === start && load.data.to === end ? load.data : undefined
  return (
    <Page title="Approvals">
      {data && <LockBanner data={data} weekStart={period.weekStart} onChange={load.refresh} />}
      <div className="approvals-bar">
        <PeriodBar period={period} />
        <div className="approvals-menus no-print">
          <Menu
            label={`Status: ${statusLabels[status]}`}
            align="end"
            items={statuses.map((id) => ({ id, label: statusLabels[id], checked: id === status, onSelect: () => change({ status: id === 'open' ? null : id }) }))}
          />
          <Menu
            label={`Group by: ${groupLabels[group]}`}
            align="end"
            items={groups.map((id) => ({ id, label: groupLabels[id], checked: id === group, onSelect: () => change({ group: id === 'person' ? null : id }) }))}
          />
        </div>
      </div>
      {load.status === 'error' && <ErrorState size="page" headingLevel={2} message={load.error} onRetry={load.reload} />}
      {load.status !== 'error' && !data && <LoadingState size="page" look="skeleton" label="Loading approvals" />}
      {data && <Overview key={`${start} ${end} ${status} ${group}`} data={data} status={status} group={group} onChange={load.refresh} />}
    </Page>
  )
}

/** Whether what is shown can still be changed, and how to lock it. */
function LockBanner({ data, weekStart, onChange }: { data: Approvals; weekStart: ReturnType<typeof usePeriod>['weekStart']; onChange: () => void }) {
  const [locking, setLocking] = useState(false)
  const toast = useToast()
  const state = lockState(data, (date) => addDays(startOfWeek(date, weekStart), 6), addDays)
  const { through, afterDays } = data.lock
  const rules = [
    through !== null && `Everything up to ${formatDate(through)} is locked.`,
    afterDays !== null && `Weeks lock by themselves ${afterDays === 1 ? '1 day' : `${afterDays} days`} after they end.`,
  ].filter(Boolean)
  return (
    <section className="lock-banner" aria-label="Lock">
      <span className="lock-icon">
        <Icon name={state === 'locked' ? 'lock' : 'unlock'} />
      </span>
      <div className="lock-text">
        <h2>{state === 'locked' ? 'Time and expenses are locked' : 'Time and expenses are still editable'}</h2>
        {state === 'open' ? (
          <p>
            You can set a recurring auto-lock from Settings or apply a one-time manual lock directly from here. Once set, time and expenses can&apos;t be edited after that deadline.
          </p>
        ) : (
          <p>{rules.join(' ')}</p>
        )}
      </div>
      {data.canLock && (
        <div className="lock-actions">
          <Link to="/settings/company" className="icon-link">
            <Icon name="settings" />
            {afterDays === null ? 'Add auto-lock in Settings' : 'Change auto-lock in Settings'}
          </Link>
          {state !== 'locked' && (
            <button type="button" className="icon-link" onClick={() => setLocking(true)}>
              <Icon name="lock" />
              Apply one-time manual lock
            </button>
          )}
        </div>
      )}
      {locking && (
        <FormDialog
          title="Apply a one-time lock"
          submitLabel="Lock"
          size="small"
          intro={<p className="muted">Nobody can change time or expenses up to this date. People with the permission can unlock single weeks.</p>}
          initial={{ through: data.to }}
          fields={[{ name: 'through', label: 'Lock everything up to', type: 'date', required: true }]}
          onClose={() => setLocking(false)}
          onSubmit={async (values) => {
            await callApi('POST', 'approvals/lock', values)
            setLocking(false)
            toast.success('Locked')
            onChange()
          }}
        />
      )}
    </section>
  )
}

const named = (names: Iterable<string>) => [...new Set(names)].filter(Boolean).sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }))
const numbered = (things: readonly { id: number; name: string }[]) =>
  [...new Map(things.map(({ id, name }) => [id, name]))].map(([id, label]) => ({ value: String(id), label })).sort((a, b) => a.label.localeCompare(b.label))

interface OverviewProps {
  data: Approvals
  status: ApprovalStatus
  group: ApprovalGroup
  onChange: () => void
}

function Overview({ data, status, group, onChange }: OverviewProps) {
  const { list, change } = useQuery()
  const filter = {
    clients: list('clients').map(Number), projects: list('projects').map(Number), people: list('people').map(Number), labels: list('roles'), departments: list('departments'), tags: list('tags'),
  }
  const { rows, total } = approvalView(data, status, group, filter)
  const choose = (name: string) => (value: string[]) => change({ [name]: value })
  const chosen = Object.values(filter).some((value) => value.length > 0)
  const percent = percentOf(total.billableMinutes, total.minutes)
  const spent = (amounts: typeof total.billableExpenses) => amounts.reduce((sum, { amount }) => sum + amount, 0)
  const all = [...total.billableExpenses, ...total.otherExpenses]
  const oneCurrency = new Set(all.map(({ currency }) => currency)).size <= 1
  const share = (amounts: typeof all) => (oneCurrency && all.length > 0 ? ` (${percentOf(spent(amounts), spent(all))}%)` : '')
  const together = [...new Map(all.map(({ currency }) => [currency, { currency, amount: spent(all.filter((sum) => sum.currency === currency)) }])).values()]

  return (
    <>
      <div className="approvals-filter no-print">
        <h2>Filter</h2>
        <div className="approvals-filters" role="group" aria-label="Filter">
          <FilterMenu label="Client" options={numbered(data.projects.map(({ client }) => client))} value={list('clients')} onChange={choose('clients')} />
          <FilterMenu label="Project" options={numbered(data.projects)} value={list('projects')} onChange={choose('projects')} />
          <FilterMenu label="Role" options={named(data.people.flatMap(({ labels }) => labels))} value={list('roles')} onChange={choose('roles')} />
          <FilterMenu label="Department" options={named(data.people.map(({ department }) => department))} value={list('departments')} onChange={choose('departments')} />
          <FilterMenu label="Tags" options={named(data.projects.flatMap(({ tags }) => tags))} value={list('tags')} onChange={choose('tags')} />
          <FilterMenu label="Teammate" options={numbered(data.people)} value={list('people')} onChange={choose('people')} />
          {chosen && (
            <Button size="small" variant="quiet" onClick={() => change({ clients: null, projects: null, roles: null, departments: null, tags: null, people: null })}>
              Clear filters
            </Button>
          )}
        </div>
      </div>
      <div className="approvals-sums">
        <section aria-label="Total time">
          <div>
            <h2>Total time</h2>
            <p className="report-figure">{formatHours(total.minutes)}</p>
          </div>
          <dl>
            <dt>
              <span className="legend-key key-billable" /> Billable
            </dt>
            <dd>{formatHours(total.billableMinutes)}</dd>
            <dd className="muted">({percent}%)</dd>
            <dt>
              <span className="legend-key key-other" /> Non-billable
            </dt>
            <dd>{formatHours(total.minutes - total.billableMinutes)}</dd>
            <dd className="muted">({total.minutes === 0 ? 0 : 100 - percent}%)</dd>
          </dl>
        </section>
        <section aria-label="Total expenses">
          <div>
            <h2>Total expenses</h2>
            <p className="report-figure">{formatAmounts(together)}</p>
          </div>
          <dl>
            <dt>Billable</dt>
            <dd>{formatAmounts(total.billableExpenses)}</dd>
            <dd className="muted">{share(total.billableExpenses)}</dd>
            <dt>Non-billable</dt>
            <dd>{formatAmounts(total.otherExpenses)}</dd>
            <dd className="muted">{share(total.otherExpenses)}</dd>
          </dl>
        </section>
      </div>
      {data.elsewhere.length > 0 && (
        <Notice>
          Other weeks wait for approval:{' '}
          {data.elsewhere.map(({ from, to, count }, index) => (
            <Fragment key={from}>
              {index > 0 && ', '}
              <Link to={`/approvals?status=submitted&from=${from}`}>
                {formatWeek(from, to)} ({count})
              </Link>
            </Fragment>
          ))}
          .
        </Notice>
      )}
      <Reminder data={data} />
      <Rows rows={rows} data={data} status={status} group={group} onChange={onChange} />
    </>
  )
}

function Reminder({ data: { reminder, canLock } }: { data: Approvals }) {
  return (
    <p>
      {reminder
        ? `JETStream automatically reminds your team to submit timesheets for approval by ${showClock(reminder.minute).replace(' ', '')}, ${weekdayNames[reminder.weekday]}.`
        : 'Your team is not reminded automatically to submit timesheets.'}
      {canLock && (
        <>
          {' '}
          You can <Link to="/settings/company">update your account settings</Link>.
        </>
      )}
    </p>
  )
}

interface RowsProps extends OverviewProps {
  rows: ApprovalRow[]
}

const empty = {
  open: { title: 'Everyone submitted', description: 'There is nothing in this period that still has to be submitted.' },
  submitted: { title: 'Nothing to approve', description: 'What people submit in this period appears here.' },
  approved: { title: 'Nothing yet', description: 'Nothing in this period was approved yet.' },
}

const plural = (count: number, one: string, more: string) => (count === 1 ? `1 ${one}` : `${count} ${more}`)

function Rows({ rows, data, status, group, onChange }: RowsProps) {
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set())
  const [open, setOpen] = useState<number | null>(null)
  const [rejecting, setRejecting] = useState<ApprovalWeek | null>(null)
  const { ask, run, dialog } = useActions()
  const toast = useToast()
  const can = useCan()
  const byPerson = group === 'person'
  const path = group === 'person' ? 'people' : group === 'project' ? 'projects' : 'clients'
  if (rows.length === 0) return <EmptyState icon="success" headingLevel={2} {...empty[status]} />

  const { from, to } = data
  const chosen = rows.filter(({ id }) => picked.has(id))
  const pick = (id: number, on: boolean) => setPicked((before) => new Set(on ? [...before, id] : [...before].filter((other) => other !== id)))
  const weeksOf = (row: ApprovalRow) => data.pending.filter(({ person }) => person.id === row.person?.id)
  const done = () => {
    setPicked(new Set())
    onChange()
  }

  const remindable = (some: readonly ApprovalRow[]) =>
    [...new Set(some.flatMap(({ personIds }) => personIds))].filter((id) => data.people.some((person) => person.id === id && person.canRemind && (byPerson || person.missing)))
  const remind = (some: readonly ApprovalRow[]) => {
    const personIds = remindable(some)
    void run('POST', 'approvals/remind', { personIds, date: from }, '', ({ reminded }: { reminded: number }) => {
      toast.success(`Reminded ${some.length === 1 && byPerson ? (some[0]?.name ?? '') : plural(reminded, 'person', 'people')}`)
      done()
    })
  }
  const submittable = (some: readonly ApprovalRow[]) => some.flatMap(({ person }) => (person?.canSubmit ? [person.id] : []))
  const submit = (some: readonly ApprovalRow[]) => {
    const personIds = submittable(some)
    ask({
      title: some.length === 1 ? `Submit for ${some[0]?.name}?` : `Submit for ${plural(personIds.length, 'person', 'people')}?`,
      message: 'Their time and expenses of this period are submitted as they are. They can no longer change them unless you send them back.',
      confirmLabel: 'Force submit', route: 'approvals/submit', body: { personIds, from, to }, done: '',
      then: ({ submitted, refused }: { submitted: number; refused: { person: string; message: string }[] }) => {
        if (submitted > 0) toast.success(`Submitted ${plural(submitted, 'week', 'weeks')}`)
        for (const { person, message } of refused) toast.warning(`${person}: ${message}`)
        done()
      },
    } as Action)
  }
  const approve = (some: readonly ApprovalRow[]) => {
    const ids = some.flatMap(weeksOf).map(({ submissionId }) => submissionId)
    void run('POST', 'approvals/approve', { ids }, some.length === 1 ? `Approved ${some[0]?.name}` : `Approved ${plural(ids.length, 'week', 'weeks')}`, done)
  }
  const unlock = (row: ApprovalRow) =>
    ask({
      title: `Unlock this period for ${row.name}?`, message: 'They can change the week that begins it for seven days, even if it is locked by date.', confirmLabel: 'Unlock', route: 'approvals/unlock',
      body: { personId: row.id, date: from }, done: 'Unlocked', then: done,
    })
  const reopen = (row: ApprovalRow, week: { submissionId: number; from: string; to: string }) =>
    ask({
      title: `Withdraw the approval of ${row.name}?`, message: `${formatWeek(week.from, week.to)}. What is not invoiced can be changed, and the week has to be submitted again.`, confirmLabel: 'Withdraw approval',
      route: `approvals/${week.submissionId}/reopen`, done: 'Approval withdrawn', then: done,
    })
  const locked = data.lock.through !== null && data.lock.through >= from

  const actions = (row: ApprovalRow) => {
    if (status === 'open') {
      return (
        <>
          {byPerson && locked && data.canUnlock && (
            <Button size="small" aria-label={`Unlock ${row.name}`} onClick={() => unlock(row)}>
              Unlock
            </Button>
          )}
          <Button size="small" aria-label={`Send reminder to ${row.name}`} aria-disabled={remindable([row]).length === 0 || undefined} onClick={() => remind([row])}>
            Send reminder
          </Button>
          {byPerson && (
            <Button
              size="small"
              aria-label={`Force submit for ${row.name}`}
              title={row.person?.canSubmit ? undefined : 'There is nothing to submit.'}
              aria-disabled={!row.person?.canSubmit || undefined}
              onClick={() => submit([row])}
            >
              Force submit
            </Button>
          )}
        </>
      )
    }
    if (!byPerson) return null
    if (status === 'approved') {
      if (!data.canUnlock) return null
      return row.person?.approved.map((week) => (
        <Button key={week.submissionId} size="small" title={week.decidedBy ? `Approved by ${week.decidedBy}` : undefined} aria-label={`Withdraw approval of ${row.name}, ${formatWeek(week.from, week.to)}`} onClick={() => reopen(row, week)}>
          Withdraw approval{row.person && row.person.approved.length > 1 ? ` (${formatWeek(week.from, week.to)})` : ''}
        </Button>
      ))
    }
    const weeks = weeksOf(row)
    const shown = open === row.id
    const [only] = weeks
    return (
      <>
        <Button size="small" variant="quiet" aria-expanded={shown} onClick={() => setOpen(shown ? null : row.id)}>
          {shown ? 'Hide' : 'Show'} details<span className="sr-only"> of {row.name}</span>
        </Button>
        {weeks.length === 1 && only && (
          <Button size="small" aria-label={`Send back the week of ${row.name}`} onClick={() => setRejecting(only)}>
            Send back
          </Button>
        )}
        {weeks.length > 0 && (
          <Button size="small" variant="primary" aria-label={weeks.length === 1 ? `Approve the week of ${row.name}` : `Approve ${weeks.length} weeks of ${row.name}`} onClick={() => approve([row])}>
            Approve
          </Button>
        )}
      </>
    )
  }

  const selectable = byPerson && status !== 'approved'
  const columns = 7 + Number(selectable)
  return (
    <>
      {chosen.length > 0 && (
        <div className="approvals-bulk" role="group" aria-label="With the chosen people">
          <span>{plural(chosen.length, 'person', 'people')} chosen</span>
          {status === 'open' && (
            <>
              <Button size="small" aria-disabled={remindable(chosen).length === 0 || undefined} onClick={() => remind(chosen)}>
                Send reminders
              </Button>
              <Button size="small" aria-disabled={submittable(chosen).length === 0 || undefined} onClick={() => submit(chosen)}>
                Force submit all
              </Button>
            </>
          )}
          {status === 'submitted' && (
            <Button size="small" variant="primary" onClick={() => approve(chosen)}>
              Approve all
            </Button>
          )}
        </div>
      )}
      <div className="table-scroll team-scroll" tabIndex={0} role="region" aria-label={statusLabels[status]}>
        <table className="approvals-table">
          <thead>
            <tr>
              {selectable && (
                <td className="approvals-pick">
                  <Checkbox
                    label="Choose everyone"
                    hideLabel
                    checked={chosen.length === rows.length}
                    indeterminate={chosen.length > 0 && chosen.length < rows.length}
                    onChange={(on) => setPicked(new Set(on ? rows.map(({ id }) => id) : []))}
                  />
                </td>
              )}
              <th scope="col">{byPerson ? 'Teammate' : groupLabels[group]}</th>
              <th scope="col" className="is-numeric">Hours</th>
              <td />
              <th scope="col">Billable Hours</th>
              <th scope="col" className="is-numeric">Billable Expenses</th>
              <th scope="col" className="is-numeric">Non-billable Expenses</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const weeks = weeksOf(row)
              return (
                <Fragment key={row.id}>
                  <tr>
                    {selectable && (
                      <td className="approvals-pick">
                        <Checkbox label={`Choose ${row.name}`} hideLabel checked={picked.has(row.id)} onChange={(on) => pick(row.id, on)} />
                      </td>
                    )}
                    <th scope="row">
                      <span className="team-member">
                        {row.person && <Avatar name={row.name} src={photoUrl(row.person.photoId)} decorative />}
                        {can('time.view') ? <Link to={`/reports/detailed?from=${from}&to=${to}&${path}=${row.id}`}>{row.name}</Link> : row.name}
                      </span>
                    </th>
                    <td className="is-numeric">
                      {row.minutes === 0 && status === 'open' && byPerson && (
                        <span className="approvals-warning" role="img" aria-label="No hours" title="No hours">
                          <Icon name="warning" />
                        </span>
                      )}
                      {formatHours(row.minutes)}
                    </td>
                    <td className="approvals-share">
                      <ShareBar billable={row.billableMinutes} minutes={row.minutes} most={row.minutes} />
                    </td>
                    <td className="is-figure">
                      {formatHours(row.billableMinutes)} ({row.minutes === 0 ? 0 : Math.round((row.billableMinutes / row.minutes) * 10_000) / 100}%)
                    </td>
                    <td className="is-numeric">{formatAmounts(row.billableExpenses)}</td>
                    <td className="is-numeric">{formatAmounts(row.otherExpenses)}</td>
                    <td>
                      <span className="approvals-actions">{actions(row)}</span>
                    </td>
                  </tr>
                  {status === 'submitted' && byPerson && open === row.id && (
                    <tr>
                      <td colSpan={columns} className="approvals-details">
                        {weeks.map((week) => (
                          <div key={week.submissionId} className="stack">
                            {weeks.length > 1 && (
                              <div className="approvals-week">
                                <strong>{formatWeek(week.from, week.to)}</strong>
                                <Button size="small" aria-label={`Send back ${formatWeek(week.from, week.to)} of ${row.name}`} onClick={() => setRejecting(week)}>
                                  Send back
                                </Button>
                              </div>
                            )}
                            {[...week.entries, ...week.expenseRows].some(({ mine }) => !mine) && (
                              <Notice>You approve the part of the week that is on your projects. The rest waits for others.</Notice>
                            )}
                            <Details week={week} />
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {!byPerson && status !== 'open' && (
        <p className="muted">
          Weeks are decided for each person. <LinkButton size="small" variant="quiet" to={`/approvals?status=${status}&period=custom&from=${from}&to=${to}`}>Group by person</LinkButton>
        </p>
      )}
      {rejecting && (
        <FormDialog
          title={`Send back the week of ${rejecting.person.name}?`}
          submitLabel="Send back"
          intro={<p className="muted">They can change it and submit it again.</p>}
          fields={[{ name: 'comment', label: 'What should be changed?', type: 'area' }]}
          onClose={() => setRejecting(null)}
          onSubmit={async (values) => {
            await callApi('POST', `approvals/${rejecting.submissionId}/reject`, values)
            setRejecting(null)
            toast.success('Sent back')
            done()
          }}
        />
      )}
      {dialog}
    </>
  )
}

function Details({ week }: { week: ApprovalWeek }) {
  const days = [...new Set(week.entries.map(({ spentOn }) => spentOn))]
  return (
    <table className="paper-lines approval-lines" aria-label={`Time of ${week.person.name}`}>
      <thead>
        <tr>
          <th scope="col">Project and task</th>
          <th scope="col">Hours</th>
        </tr>
      </thead>
      <tbody>
        {days.map((day) => (
          <Fragment key={day}>
            <tr>
              <th scope="rowgroup" colSpan={2}>
                {formatDay(day)}
              </th>
            </tr>
            {week.entries
              .filter(({ spentOn }) => spentOn === day)
              .map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <span className="strong">{entry.project}</span> <span className="muted">({entry.client})</span>, {entry.task}
                    {!entry.billable && <span className="muted"> (non-billable)</span>}
                    {entry.notes && <span className="line muted">{entry.notes}</span>}
                  </td>
                  <td>{formatHours(entry.minutes)}</td>
                </tr>
              ))}
          </Fragment>
        ))}
        {week.expenseRows.length > 0 && (
          <tr>
            <th scope="rowgroup" colSpan={2}>
              Expenses
            </th>
          </tr>
        )}
        {week.expenseRows.map((expense) => (
          <tr key={expense.id}>
            <td>
              {formatDate(expense.spentOn)}, {expense.category}, <span className="strong">{expense.project}</span>
              {expense.notes && <span className="line muted">{expense.notes}</span>}
            </td>
            <td>{formatMoney(expense.amount, expense.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
