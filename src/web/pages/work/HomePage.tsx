import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { HomeInfo } from '../../../shared/work'
import { useCan, usePerson } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { photoUrl } from '../../shell/photo'
import { Page } from '../../shell/Page'
import { Avatar, BarChart, Button, Card, ErrorState, formatLongDate, Legend, LinkButton, LoadingState, Meter, monthNames, partsOf, weekdayNames, weekdayOf } from '../../ui'
import { formatDecimalHours, formatHours, formatMoney, percentOf } from '../../work/format'
import { Amounts, BudgetBar, hourSeries } from '../../work/parts'
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
    <Page title="Home">
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
  const can = useCan()
  const { again, start, stop } = useTimer()
  const { week, capacityMinutes, running, recent, projects, money, team, today } = info
  const total = week.reduce((sum, { billable, other }) => sum + billable + other, 0)
  const billable = week.reduce((sum, day) => sum + day.billable, 0)

  return (
    <>
      <p className="home-lead">
        {greeting(timeZone, info.now)}, {name.split(' ')[0]}. {formatHours(total)} of {formatHours(capacityMinutes)} hours this week, {percentOf(billable, total)}% billable.
      </p>

      {money && (
        <div className="tiles">
          <Tile label="Outstanding" value={<Amounts amounts={money.outstanding} />} detail="on open invoices" to="/invoices?show=open" />
          <Tile
            label="Past due"
            value={<Amounts amounts={money.late} />}
            detail={`${money.late.reduce((sum, { count }) => sum + count, 0)} late invoices`}
            to="/invoices?show=late"
          />
          <Tile label="Ready to invoice" value={<Amounts amounts={money.unbilled} />} detail="hours and expenses not billed yet" to="/invoices/new" />
          <Tile label="Drafts" value={String(money.drafts)} detail="waiting to be sent" to="/invoices?show=draft" />
        </div>
      )}

      <div className="columns">
        <Card title="Your week" actions={<Legend series={hourSeries} />}>
          <BarChart
            label="Your hours this week"
            series={hourSeries}
            unit={60}
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
  label: string
  value: ReactNode
  detail: ReactNode
  to: string
}

function Tile({ label, value, detail, to }: TileProps) {
  return (
    <Link to={to} className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      <span className="tile-detail">{detail}</span>
    </Link>
  )
}
