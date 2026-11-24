/** The rest of the demo: schedule, notifications, messages, reports and the activity log. */
import type { IsoDate } from '../../shared/dates'
import {
  activityLog, assignments, milestones, notifications, outboxMessages, placeholders, savedReports,
} from '../db/schema'
import type { DemoDates, DemoRows } from './builder'
import type { Company, PersonKey, ProjectKey, TaskKey } from './company'

export function addExtras(rows: DemoRows, dates: DemoDates, company: Company): void {
  addSchedule(rows, dates, company)
  addMessages(rows, dates, company)
  addActivity(rows, dates, company)
}

function addSchedule(rows: DemoRows, dates: DemoDates, company: Company) {
  const { week } = dates
  const hire = rows.add(placeholders, { name: 'Structural engineer (to hire)' })
  const assign = (
    who: PersonKey | 'placeholder',
    project: ProjectKey,
    task: TaskKey,
    startsOn: IsoDate,
    endsOn: IsoDate,
    hoursPerDay: number,
    more: { repeat?: 'weekly' | 'every_two_weeks'; repeatUntil?: IsoDate; notes?: string } = {},
  ) =>
    rows.add(assignments, {
      projectId: company.projects[project], taskId: company.tasks[task],
      personId: who === 'placeholder' ? null : company.people[who].id, placeholderId: who === 'placeholder' ? hire : null,
      startsOn, endsOn, minutesPerDay: hoursPerDay * 60, ...more,
    })
  assign('lead', 'turbine', 'management', week(-4), week(8, 4), 2)
  assign('lead', 'coldStore', 'management', week(-2), week(3, 4), 3)
  assign('employee', 'turbine', 'design', week(-4), week(1, 4), 4)
  assign('employee', 'pumps', 'design', week(0), week(5, 4), 3)
  assign('employee', 'substation', 'inspection', week(-3, 3), week(-3, 4), 8, {
    repeat: 'every_two_weeks', repeatUntil: week(7, 4), notes: 'Regular inspection round',
  })
  assign('marcus', 'turbine', 'design', week(-4), week(4, 4), 4)
  assign('marcus', 'pumps', 'commissioning', week(2), week(8, 4), 4)
  assign('tomas', 'substation', 'inspection', week(-4), week(6, 4), 5)
  assign('tomas', 'coldStore', 'inspection', week(1), week(3, 4), 3)
  assign('owen', 'coldStore', 'drafting', week(-4), week(2, 4), 5)
  assign('owen', 'turbine', 'drafting', week(0), week(8, 4), 3)
  assign('priya', 'assembly', 'management', week(-4), week(2, 4), 3)
  assign('priya', 'boiler', 'design', week(1), week(2, 4), 4)
  assign('elena', 'assembly', 'design', week(-3), week(6, 4), 5)
  assign('elena', 'safety', 'inspection', week(-4, 1), week(-4, 1), 6, { repeat: 'weekly', repeatUntil: week(4, 1) })
  assign('dana', 'controls', 'commissioning', week(-4), week(5, 4), 6)
  assign('placeholder', 'turbine', 'design', week(2), week(8, 4), 6, { notes: 'If the extension is approved' })
  assign('placeholder', 'boiler', 'commissioning', week(5), week(8, 4), 8)

  const milestone = (project: ProjectKey, name: string, dueOn: IsoDate, completedOn: IsoDate | null = null) =>
    rows.add(milestones, { projectId: company.projects[project], name, dueOn, completedOn })
  milestone('turbine', 'Drawings issued for review', week(-3, 2), week(-3, 1))
  milestone('turbine', 'Foundation design approved', week(3, 4))
  milestone('coldStore', 'Handover', week(4, 2))
  milestone('controls', 'Factory acceptance test', week(2, 3))
}

function addMessages(rows: DemoRows, dates: DemoDates, company: Company) {
  const { people } = company
  const notify = (who: PersonKey, kind: string, title: string, body: string, path: string, daysAgo: number, read: boolean) => {
    const createdAt = dates.past(dates.daysFromToday(-daysAgo), 8, 30)
    rows.add(notifications, {
      personId: people[who].id, kind, title, body, path, createdAt,
      readAt: read ? dates.past(dates.daysFromToday(1 - daysAgo), 9) : null,
    })
  }
  notify('admin', 'invoice_late', 'An invoice is late', 'Kestrel Maschinenbau GmbH has an invoice past its due date.', '/invoices', 1, false)
  notify('admin', 'sign_up', 'Someone asks to join', 'Noah Pemberly is waiting for approval.', '/team', 2, false)
  notify('admin', 'estimate_accepted', 'Estimate accepted', 'Tallgrass Wind Cooperative accepted an estimate.', '/estimates', 9, true)
  notify('lead', 'approval', 'Timesheets to approve', 'Marcus Oyelaran and Tomas Brennan submitted last week.', '/approvals', 1, false)
  notify('lead', 'budget', 'Budget alert', 'Turbine foundation design has passed 80% of its budget.', '/projects', 4, false)
  notify('lead', 'budget', 'Over budget', 'Cold store expansion is over its budget.', '/projects', 6, true)
  notify('employee', 'approved', 'Week approved', 'Your last week was approved.', '/time', 1, false)
  notify('employee', 'assignment', 'New assignment', 'You are scheduled on Pump station upgrade.', '/schedule', 5, true)
  notify('owen', 'rejected', 'Week sent back', 'Please split the Wednesday hours between drafting and design.', '/time', 1, false)

  const remind = (who: PersonKey, name: string, email: string) => {
    const createdAt = dates.past(dates.daysFromToday(-1), 8)
    rows.add(outboxMessages, {
      kind: 'timesheet_reminder', status: 'captured', recipients: [{ name, email }], subject: 'Please submit your week',
      body: `Hello ${name},\n\nyour time for last week has not been submitted yet.`, subjectType: 'person',
      subjectId: people[who].id, createdAt,
    })
  }
  remind('dana', 'Dana Whitlock', 'dana.whitlock@contractors.example')
  remind('owen', 'Owen Sutherby', 'owen.sutherby@jet.example')

  rows.add(savedReports, {
    ownerId: people.admin.id, name: 'Hours by client, this month', kind: 'time', visibility: 'shared',
    definition: { groupBy: 'client', period: 'this-month' }, createdAt: dates.past(dates.week(-5), 15),
  })
}

function addActivity(rows: DemoRows, dates: DemoDates, company: Company) {
  const { people, projects, clients } = company
  const log = (
    who: PersonKey | null, action: string, subjectType: string, subjectId: number, summary: string, date: IsoDate, hour: number,
    changes: Record<string, unknown> = {},
  ) =>
    rows.add(activityLog, {
      actorId: who === null ? null : people[who].id, action, subjectType, subjectId, summary, changes,
      createdAt: dates.past(date, hour),
    })
  const raise = { billable: [11_000, 11_800] }
  log('admin', 'updated', 'person', people.employee.id, 'Changed the rates of Casey Lindgren', dates.week(-12), 9, raise)
  log('admin', 'archived', 'person', people.lydia.id, 'Archived Lydia Farrow', dates.week(-11, 4), 17)
  log('lead', 'archived', 'project', projects.quarry, 'Archived project Conveyor route survey', dates.week(-7), 11)
  log('admin', 'archived', 'client', clients.quarry, 'Archived client Old Quarry Materials', dates.week(-7), 11)
  log('lead', 'updated', 'project', projects.turbine, 'Changed the budget of Turbine foundation design', dates.week(-4, 1), 10)
  log('admin', 'created', 'project', projects.boiler, 'Created project Boiler replacement from an estimate', dates.week(-3), 13)
  log('priya', 'updated', 'project', projects.controls, 'Moved the end date of Control system integration', dates.week(-2, 2), 15)
  log('lead', 'submitted', 'submission', people.lead.id, 'Submitted a week', dates.week(-1, 4), 17)
  log('employee', 'submitted', 'submission', people.employee.id, 'Submitted a week', dates.week(-1, 4), 17)
  log('lead', 'approved', 'submission', people.employee.id, 'Approved a week of Casey Lindgren', dates.week(0), 9)
  log('lead', 'rejected', 'submission', people.owen.id, 'Sent back a week of Owen Sutherby', dates.week(0), 9)
  log(null, 'requested', 'person', people.noah.id, 'Noah Pemberly asked to join', dates.daysFromToday(-2), 9)
}
