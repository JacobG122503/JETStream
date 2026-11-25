import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { TeamMember, TeamWeek } from '../../../shared/work'
import { useLoad } from '../../auth/useLoad'
import { photoUrl } from '../../shell/photo'
import { addDays, Avatar, ErrorState, Icon, IconButton, LoadingState } from '../../ui'
import { formatHours, formatWeek, percentOf } from '../../work/format'
import '../../work/work.css'

const kinds = [
  { id: 'employee', title: 'Employees' },
  { id: 'contractor', title: 'Contractors' },
] as const

/** Who worked how much in a week. */
export function MembersPanel() {
  const [date, setDate] = useState<string | null>(null)
  const { status, data, error, reload } = useLoad<TeamWeek>(date === null ? 'team' : `team?date=${date}`)
  if (status === 'loading') return <LoadingState look="skeleton" label="Loading the team" />
  if (!data) return <ErrorState message={error} onRetry={reload} />
  const sum = (value: (member: TeamMember) => number) => data.members.reduce((total, member) => total + value(member), 0)
  const minutes = sum((member) => member.minutes)
  const billable = sum((member) => member.billableMinutes)
  const current = data.today >= data.from && data.today <= data.to
  return (
    <div className="stack">
      <div className="time-bar">
        <div className="date-nav">
          <IconButton icon="chevronLeft" label="Week before" onClick={() => setDate(addDays(data.from, -7))} />
          <p aria-live="polite">
            <Icon name="calendar" />
            <span>
              {current && <span className="muted">This week </span>}
              {formatWeek(data.from, data.to)}
            </span>
          </p>
          <IconButton icon="chevronRight" label="Next week" onClick={() => setDate(addDays(data.from, 7))} />
        </div>
        {!current && (
          <button type="button" className="text-button" onClick={() => setDate(null)}>
            Return to this week
          </button>
        )}
      </div>
      <dl className="figures">
        <div>
          <dt>Total hours</dt>
          <dd>{formatHours(minutes)}</dd>
        </div>
        <div>
          <dt>Team capacity</dt>
          <dd>{formatHours(sum((member) => member.capacityMinutes))}</dd>
        </div>
        <div>
          <dt>
            <span className="legend-key key-billable" /> Billable
          </dt>
          <dd>{formatHours(billable)}</dd>
        </div>
        <div>
          <dt>
            <span className="legend-key key-other" /> Non-billable
          </dt>
          <dd>{formatHours(minutes - billable)}</dd>
        </div>
      </dl>
      {kinds.map(({ id, title }) => {
        const members = data.members.filter(({ kind }) => kind === id)
        return members.length === 0 ? null : <Members key={id} title={`${title} (${members.length})`} members={members} />
      })}
    </div>
  )
}

function Members({ title, members }: { title: string; members: TeamMember[] }) {
  return (
    <div className="table-scroll team-scroll" tabIndex={0} role="region" aria-label={title}>
      <table className="team-table">
        <thead>
          <tr>
            <th scope="col">{title}</th>
            <th scope="col" className="is-numeric">
              Hours
            </th>
            <th scope="col">
              <span className="sr-only">Hours of the capacity</span>
            </th>
            <th scope="col" className="is-numeric">
              Utilization
            </th>
            <th scope="col" className="is-numeric">
              Capacity
            </th>
            <th scope="col" className="is-numeric">
              Billable
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map(({ id, name, photoId, role, minutes, billableMinutes, capacityMinutes }) => {
            const whole = Math.max(capacityMinutes, minutes, 1)
            return (
              <tr key={id}>
                <th scope="row">
                  <span className="team-member">
                    <Avatar name={name} src={photoUrl(photoId)} size="small" decorative />
                    <Link to={`/team/${id}`}>{name}</Link>
                    <span className="role-pill">{role}</span>
                  </span>
                </th>
                <td className="is-numeric">{formatHours(minutes)}</td>
                <td className="team-bar">
                  <span className="capacity" aria-hidden="true">
                    <span className="key-billable" style={{ width: `${(billableMinutes / whole) * 100}%` }} />
                    <span className="key-other" style={{ width: `${((minutes - billableMinutes) / whole) * 100}%` }} />
                  </span>
                </td>
                <td className="is-numeric">{percentOf(minutes, capacityMinutes)}%</td>
                <td className="is-numeric">{formatHours(capacityMinutes)}</td>
                <td className="is-numeric">{formatHours(billableMinutes)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
