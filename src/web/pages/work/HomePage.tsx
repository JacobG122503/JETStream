import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { HomeInfo } from '../../../shared/work'
import { useAuth, useCan, usePerson } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { photoUrl } from '../../shell/photo'
import { Page } from '../../shell/Page'
import { StreamLines } from '../../shell/StreamLines'
import { Avatar, BarChart, Button, Card, ErrorState, formatLongDate, Icon, type IconName, Legend, LinkButton, LoadingState, Meter, monthNames, partsOf, weekdayNames, weekdayOf } from '../../ui'
import { Clock } from '../../work/Clock'
import { formatAmounts, formatDecimalHours, formatHours, formatMoney, percentOf } from '../../work/format'
import { BudgetBar, hourSeries } from '../../work/parts'
import { useTimer } from '../../work/timerContext'
import '../../work/work.css'

export function HomePage() {
  const { changes } = useTimer()
  const { access } = usePerson()
  return <Home key={`${access} ${changes}`} />
}

function Home() {
  const { status, data, error, reload } = useLoad<HomeInfo>('home')
  return (
    <Page title="Home" hideTitle>
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading your overview" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && <Overview info={data} />}
    </Page>
  )
}

function greeting(timeZone: string, now: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)))
  if (hour < 12) return 'Good morning'
  return hour < 18 ? 'Good afternoon' : 'Good evening'
}

function Overview({ info }: { info: HomeInfo }) {
  const { name, timeZone } = usePerson()
  const { info: session } = useAuth()
  const can = useCan()
  const { again, start, stop } = useTimer()
  const { week, capacityMinutes, running, recent, projects, money, team, today } = info
  const total = week.reduce((sum, { billable, other }) => sum + billable + other, 0)
  const billable = week.reduce((sum, day) => sum + day.billable, 0)

  return (
    <>
      <section className="hero" aria-label="This week">
        <StreamLines className="hero-lines" count={12} width={1200} height={320} />
        <div className="hero-text">
          <p className="hero-date">{formatLongDate(today)}</p>
          <p className="hero-title">
            {greeting(timeZone, info.now)}, {name.split(' ')[0]}
          </p>
          <p className="hero-lead">
            {running ? (
              <>
                You are on <strong>{running.task}</strong> for <strong>{running.project}</strong>.
              </>
            ) : (
              <>
                {session?.company.name}: {formatHours(total)} of {formatHours(capacityMinutes)} hours this week, {percentOf(billable, total)}% billable.
              </>
            )}
          </p>
          <div className="hero-actions">
            {running ? (
              <Button icon="stop" variant="primary" onClick={() => void stop()}>
                Stop timer
              </Button>
            ) : (
              <LinkButton to="/time?new=1" variant="primary" icon="plus">
                Track time
              </LinkButton>
            )}
            <LinkButton to="/time" className="btn-glass">
              My timesheet
            </LinkButton>
          </div>
        </div>
        <div className="hero-side">
          <p className="hero-figure">{running ? <Clock entry={running} /> : formatHours(total)}</p>
          <p className="hero-caption">{running ? 'running now' : 'tracked this week'}</p>
          <div className="hero-bar">
            <span style={{ width: `${Math.min(100, percentOf(total, capacityMinutes))}%` }} />
          </div>
        </div>
      </section>

      {money && (
        <div className="tiles">
          <Tile icon="dollar" label="Outstanding" value={formatAmounts(money.outstanding, { whole: true })} detail="on open invoices" to="/invoices?show=open" />
          <Tile
            icon="warning"
            tone={money.late.length > 0 ? 'warning' : undefined}
            label="Past due"
            value={formatAmounts(money.late, { whole: true })}
            detail={`${money.late.reduce((sum, { count }) => sum + count, 0)} late invoices`}
            to="/invoices?show=late"
          />
          <Tile icon="time" label="Ready to invoice" value={formatAmounts(money.unbilled, { whole: true })} detail="hours and expenses not billed yet" to="/invoices/new" />
          <Tile icon="edit" label="Drafts" value={String(money.drafts)} detail="waiting to be sent" to="/invoices?show=draft" />
        </div>
      )}

      <div className="columns">
        <Card title="Your week" actions={<Legend series={hourSeries} />}>
          <BarChart
            label="Your hours this week"
            series={hourSeries}
            format={formatDecimalHours}
            points={week.map(({ day, billable: hours, other }) => ({
              id: day, label: weekdayNames[weekdayOf(day)].slice(0, 3), title: formatLongDate(day), values: [hours, other], current: day === today,
            }))}
          />
        </Card>
        <Card title="Pick up where you left off">
          {recent.length === 0 ? (
            <p className="muted">Nothing tracked yet.</p>
          ) : (
            <ul className="resume">
              {recent.map((entry) => {
                const isRunning = running?.id === entry.id
                const go = () => (entry.spentOn === today && entry.locked === null ? start(entry) : again(entry))
                return (
                  <li key={entry.id}>
                    <span className="resume-text">
                      <span className="strong">{entry.task}</span>
                      <span className="muted">
                        {entry.project}, {entry.client}
                      </span>
                    </span>
                    <Button
                      size="small"
                      icon={isRunning ? 'stop' : 'play'}
                      aria-label={isRunning ? 'Stop timer' : `Start timer for ${entry.task}, ${entry.project}`}
                      onClick={() => void (isRunning ? stop() : go())}
                    >
                      {isRunning ? 'Stop' : 'Start'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      {money && (
        <Card title={`Invoiced and paid (${money.currency})`} actions={<Legend series={moneySeries} />}>
          <BarChart
            label="Invoiced and paid by month"
            look="grouped"
            series={moneySeries}
            format={(value) => formatMoney(value, money.currency, { whole: true })}
            points={money.months.map(({ month, invoiced, paid }) => {
              const { year, month: number } = partsOf(`${month}-01`)
              const title = monthNames[number - 1] ?? ''
              return { id: month, label: title.slice(0, 3), title: `${title} ${year}`, values: [invoiced, paid] }
            })}
          />
        </Card>
      )}

      <div className="columns">
        {projects.length > 0 && (
          <Card title="Budgets to watch" actions={<LinkButton size="small" variant="quiet" to="/projects">All projects</LinkButton>}>
            <ul className="budget-list">
              {projects.map((project) => (
                <li key={project.id}>
                  <div className="budget-head">
                    <Link to={`/projects/${project.id}`}>{project.name}</Link>
                    <span className="muted">{project.client.name}</span>
                  </div>
                  <BudgetBar project={project} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        {team && team.length > 0 && (
          <Card title="Team this week" actions={can('people.view') && <LinkButton size="small" variant="quiet" to="/team">Team</LinkButton>}>
            <ul className="team-list">
              {team.map(({ id, name: who, photoId, minutes, capacityMinutes: capacity }) => (
                <li key={id}>
                  <Avatar name={who} src={photoUrl(photoId)} size="small" decorative />
                  <span className="team-name">{who}</span>
                  <Meter percent={percentOf(minutes, capacity)} />
                  <span className="figure">{formatHours(minutes)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  )
}

const moneySeries = [
  { id: 'invoiced', label: 'Invoiced', colour: 2 as const },
  { id: 'paid', label: 'Paid', colour: 1 as const },
]

interface TileProps {
  icon: IconName
  label: string
  value: string
  detail: ReactNode
  to: string
  tone?: 'warning'
}

function Tile({ icon, label, value, detail, to, tone }: TileProps) {
  return (
    <Link to={to} className={tone ? `tile tile-${tone}` : 'tile'}>
      <span className="tile-icon">
        <Icon name={icon} />
      </span>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      <span className="tile-detail">{detail}</span>
    </Link>
  )
}
