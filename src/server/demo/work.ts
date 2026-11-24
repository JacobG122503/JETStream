/** What the demo people did: time, time off, weekly submissions and expenses. */
import type { InferInsertModel } from 'drizzle-orm'
import { expenseAmount, resolveBillableRate, timeAmount } from '../../shared/calc'
import { addDays, type IsoDate, partsOf } from '../../shared/dates'
import type { EntryStatus } from '../../shared/domain'
import {
  approvalEvents, expenseReceipts, expenses, files, holidayCalendars, holidays, submissions,
  timeEntries, timeFavorites, timeOffEntries, timeOffPolicies, timeOffPolicyPeople, timeOffRequests, workSchedules,
} from '../db/schema'
import { type Choices, datesBetween, type DemoDates, type DemoRows, isWeekday } from './builder'
import {
  type BudgetRows, type Company, type DemoPerson, holidaysFor, type PersonKey, type ProjectKey, projectsPlan,
  quarryLastWeek, type TaskKey,
} from './company'
import { pdfReceipt, pngReceipt } from './receipts'

export const historyWeeks = 26

export interface WorkedEntry {
  id: number
  project: ProjectKey
  person: PersonKey
  date: IsoDate
  billable: boolean
  status: EntryStatus
}

export interface Work {
  time: WorkedEntry[]
  expenses: WorkedEntry[]
}

export function addWork(
  rows: DemoRows,
  dates: DemoDates,
  choices: Choices,
  company: Company & BudgetRows,
): Work {
  const daysOff = addTimeOff(rows, dates, company)
  const worked = addTime(rows, dates, choices, company, daysOff)
  addSubmissions(rows, dates, company, worked)
  setBudgets(company, worked)
  return { time: worked, expenses: addExpenses(rows, dates, choices, company, worked) }
}

const workers = (company: Company) => Object.values(company.people).filter(({ key }) => key !== 'noah')

// Time off -----------------------------------------------------------------------------------------

/** Returns the days off by person id, holidays under 0. */
function addTimeOff(rows: DemoRows, dates: DemoDates, company: Company): Map<number, Set<IsoDate>> {
  const { people } = company
  const calendarId = rows.add(holidayCalendars, { name: 'US holidays', isDefault: true })
  const year = partsOf(dates.today).year
  const free = new Set<IsoDate>()
  for (const holiday of holidaysFor([year - 1, year, year + 1])) {
    rows.add(holidays, { calendarId, ...holiday })
    free.add(holiday.observedOn)
  }
  rows.add(workSchedules, { name: 'Standard week', isDefault: true })
  const daysOff = new Map<number, Set<IsoDate>>([[0, free]])

  const policy = {
    vacation: rows.add(timeOffPolicies, {
      name: 'Vacation', kind: 'vacation', paid: true, accrualMethod: 'monthly', accrualMinutes: 600,
      maximumBalanceMinutes: 14_400, carryOverMinutes: 2400,
    }),
    sick: rows.add(timeOffPolicies, {
      name: 'Sick leave', kind: 'sick', paid: true, accrualMethod: 'yearly', accrualMinutes: 2400, requiresApproval: false,
    }),
    unpaid: rows.add(timeOffPolicies, { name: 'Unpaid leave', kind: 'unpaid', paid: false, accrualMethod: 'none' }),
  }
  const request = (
    key: PersonKey,
    kind: keyof typeof policy,
    status: 'pending' | 'approved' | 'declined' | 'cancelled',
    first: IsoDate,
    last: IsoDate,
    note: string,
    decisionComment = '',
  ) => {
    const person = people[key]
    const decided = status === 'approved' || status === 'declined'
    const asked = dates.past(addDays(first, -14), 9)
    const requestId = rows.add(timeOffRequests, {
      policyId: policy[kind], personId: person.id, startsOn: first, endsOn: last, minutesPerDay: person.dayMinutes, status,
      note, decidedBy: decided ? people[person.manager ?? 'admin'].id : null,
      decidedAt: decided ? dates.past(addDays(first, -12), 10) : null, decisionComment, createdAt: asked,
    })
    if (status !== 'approved') return
    const days = datesBetween(first, last).filter((date) => isWeekday(date) && !free.has(date))
    const own = daysOff.get(person.id) ?? new Set()
    days.forEach((date) => own.add(date))
    daysOff.set(person.id, own)
    rows.add(timeOffEntries, {
      policyId: policy[kind], personId: person.id, kind: 'used', occurredOn: first, requestId,
      minutes: -days.length * person.dayMinutes,
    })
  }
  request('lead', 'vacation', 'approved', dates.week(-18), dates.week(-18, 4), 'Family visit')
  request('employee', 'vacation', 'approved', dates.week(-9, 2), dates.week(-9, 4), 'Long weekend')
  request('employee', 'sick', 'approved', dates.week(-21, 1), dates.week(-21, 1), '')
  request('marcus', 'vacation', 'approved', dates.week(-15), dates.week(-15, 4), 'Hiking')
  request('elena', 'vacation', 'approved', dates.week(-6), dates.week(-6, 4), 'Wedding')
  request('tomas', 'sick', 'approved', dates.week(-4, 3), dates.week(-4, 4), '')
  request('dana', 'unpaid', 'approved', dates.week(-12), dates.week(-12, 2), 'Moving house')
  request('owen', 'vacation', 'approved', dates.week(-23, 3), dates.week(-23, 4), '')
  request('priya', 'vacation', 'approved', dates.week(3), dates.week(3, 4), 'Holiday booked')
  request('lead', 'vacation', 'pending', dates.week(5, 3), dates.week(5, 4), 'Concert weekend')
  request('employee', 'vacation', 'pending', dates.week(4), dates.week(4, 4), 'Visiting family')
  request('marcus', 'vacation', 'declined', dates.week(1), dates.week(1, 4), 'Short notice, sorry', 'Cold store handover that week.')
  request('owen', 'vacation', 'cancelled', dates.week(2, 1), dates.week(2, 2), 'Plans changed')

  const startsOn = dates.week(-30)
  const months = [...new Set(datesBetween(startsOn, dates.today).filter((date) => date.endsWith('-01')))]
  for (const person of workers(company).filter(({ active }) => active)) {
    for (const policyId of Object.values(policy)) {
      rows.add(timeOffPolicyPeople, { policyId, personId: person.id, startsOn })
    }
    const opening = { kind: 'adjustment' as const, occurredOn: startsOn, notes: 'Opening balance' }
    rows.add(timeOffEntries, { policyId: policy.vacation, personId: person.id, minutes: 2400, ...opening })
    rows.add(timeOffEntries, { policyId: policy.sick, personId: person.id, minutes: 2400, ...opening })
    for (const occurredOn of months) {
      rows.add(timeOffEntries, { policyId: policy.vacation, personId: person.id, kind: 'accrual', minutes: 600, occurredOn })
    }
  }
  return daysOff
}

// Time ---------------------------------------------------------------------------------------------

interface TimeRow extends WorkedEntry {
  row: InferInsertModel<typeof timeEntries>
}

function addTime(
  rows: DemoRows,
  dates: DemoDates,
  choices: Choices,
  company: Company,
  daysOff: Map<number, Set<IsoDate>>,
): TimeRow[] {
  const worked: TimeRow[] = []
  const yesterday = addDays(dates.today, -1)
  for (const date of datesBetween(dates.week(-historyWeeks), yesterday)) {
    if (!isWeekday(date) || daysOff.get(0)?.has(date)) continue
    for (const person of workers(company)) {
      if (person.archivedOn !== null && date > person.archivedOn) continue
      if (daysOff.get(person.id)?.has(date)) continue
      // Now and then a day was forgotten, but not in the last weeks, which people look at first.
      if (date < dates.week(-3) && choices.chance(3)) continue
      for (const entry of workDay(dates, choices, company, person, date)) {
        const row: InferInsertModel<typeof timeEntries> = {
          personId: person.id, projectId: company.projects[entry.project], taskId: company.tasks[entry.task],
          spentOn: date, minutes: entry.minutes, notes: choices.pick(company.notesFor[entry.task]), billable: entry.billable,
          status: 'unsubmitted', createdBy: person.id, createdAt: dates.past(date, 17, choices.between(0, 40)),
        }
        const id = rows.add(timeEntries, row)
        const { project, billable } = entry
        worked.push({ id, project, person: person.key, date, billable, status: 'unsubmitted', row })
      }
    }
  }

  const { employee } = company.people
  for (const [position, [project, task]] of ([['turbine', 'design'], ['substation', 'inspection']] as const).entries()) {
    rows.add(timeFavorites, {
      personId: employee.id, projectId: company.projects[project], taskId: company.tasks[task], position,
    })
  }
  return worked
}

/** A day's entries: 4 to 10 hours in all, in quarter hours, each project and task once. */
function workDay(dates: DemoDates, choices: Choices, company: Company, person: DemoPerson, date: IsoDate) {
  const open = person.work.filter(({ project }) => project !== 'quarry' || date < dates.week(quarryLastWeek + 1))
  let left = person.dayMinutes + choices.between(-3, 4) * 15
  const entries = new Map<string, { project: ProjectKey; task: TaskKey; billable: boolean; minutes: number }>()
  while (left > 0) {
    // The last piece takes what is left, so the day's total never depends on the pieces.
    const minutes = left <= 90 ? left : Math.min(left, choices.between(4, 16) * 15)
    const { project } = choices.pickWeighted(open)
    const { key: task, billable } = choices.pickWeighted(company.projectTasks[project])
    const known = entries.get(`${project}/${task}`)
    if (known) known.minutes += minutes
    else entries.set(`${project}/${task}`, { project, task, billable, minutes })
    left -= minutes
  }
  return entries.values()
}

// Weekly submissions ---------------------------------------------------------------------------------

/** How last week stands; everyone else's is approved. */
const lastWeek: Partial<Record<PersonKey, 'submitted' | 'rejected' | 'missing'>> = {
  marcus: 'submitted', tomas: 'submitted', owen: 'rejected', dana: 'missing',
}
const rejection = 'Please split the Wednesday hours between drafting and design.'

function addSubmissions(rows: DemoRows, dates: DemoDates, company: Company, worked: readonly TimeRow[]) {
  const entriesOf = new Map<string, TimeRow[]>()
  const weekOf = (date: IsoDate) => weeks.find((start) => start <= date && date <= addDays(start, 6))
  const weeks = Array.from({ length: historyWeeks }, (_, index) => dates.week(index - historyWeeks))
  for (const entry of worked) {
    const key = `${entry.person}/${weekOf(entry.date) ?? ''}`
    entriesOf.set(key, [...(entriesOf.get(key) ?? []), entry])
  }
  for (const periodStart of weeks) {
    for (const person of workers(company)) {
      const entries = entriesOf.get(`${person.key}/${periodStart}`)
      if (!entries) continue
      const standing = periodStart === dates.week(-1) ? (lastWeek[person.key] ?? 'approved') : 'approved'
      if (standing === 'missing') continue
      for (const entry of entries) entry.status = entry.row.status = standing
      const deciderId = company.people[person.manager ?? 'lead'].id
      const submittedAt = dates.past(addDays(periodStart, 4), 17, 45)
      const decidedAt = dates.past(addDays(periodStart, 7), 9, 30)
      const decided = standing !== 'submitted'
      const comment = standing === 'rejected' ? rejection : ''
      const submissionId = rows.add(submissions, {
        personId: person.id, periodStart, periodEnd: addDays(periodStart, 6), status: standing, submittedAt, comment,
        decidedBy: decided ? deciderId : null, decidedAt: decided ? decidedAt : null, createdAt: submittedAt,
      })
      rows.add(approvalEvents, { submissionId, actorId: person.id, action: 'submitted', createdAt: submittedAt })
      if (decided) {
        rows.add(approvalEvents, { submissionId, actorId: deciderId, action: standing, comment, createdAt: decidedAt })
      }
    }
  }
}

// Budgets --------------------------------------------------------------------------------------------

/** Sets budgets to fit the work: the cold store is over, the turbine past its alert, the rest within. */
function setBudgets(company: Company & BudgetRows, worked: readonly TimeRow[]) {
  const of = (project: ProjectKey) => worked.filter((entry) => entry.project === project)
  const sumMinutes = (entries: readonly TimeRow[]) => entries.reduce((sum, { row }) => sum + row.minutes, 0)
  const ratio = (value: number, percent: number) => Math.ceil((value * 100) / percent)
  const roundHours = (minutes: number) => Math.ceil(minutes / 600) * 600

  company.projectRow('coldStore').budgetMinutes = Math.floor(sumMinutes(of('coldStore')) / 1.07 / 600) * 600
  company.projectRow('turbine').budgetAmount = Math.ceil(ratio(fees(company, of('turbine')), 88) / 10_000) * 10_000
  company.projectRow('assembly').budgetAmount = Math.ceil(ratio(fees(company, of('assembly')), 62) / 100_000) * 100_000

  const monthly = new Map<string, number>()
  for (const { date, row } of of('substation')) {
    const month = date.slice(0, 7)
    monthly.set(month, (monthly.get(month) ?? 0) + row.minutes)
  }
  company.projectRow('substation').budgetMinutes = roundHours(ratio(Math.max(0, ...monthly.values()), 80))

  for (const { id, key } of company.projectTasks.pumps) {
    const used = sumMinutes(of('pumps').filter(({ row }) => row.taskId === company.tasks[key]))
    company.taskRow(id).budgetMinutes = roundHours(ratio(used, 75) + 600)
  }
  for (const person of ['priya', 'elena', 'dana'] as const) {
    const used = sumMinutes(of('safety').filter((entry) => entry.person === person))
    company.memberRow('safety', person).budgetMinutes = roundHours(ratio(used, 70) + 600)
  }
}

/** Fees of time on a project that bills by project or person. */
function fees(company: Company, entries: readonly TimeRow[]): number {
  return entries.reduce((sum, { row, project, person, date, billable }) => {
    const { type, rateMethod, rate = null, client, memberRates } = projectsPlan[project]
    const resolved = resolveBillableRate({
      date, billable, companyCurrency: 'USD',
      project: { type, rateMethod, rate, currency: client === 'kestrel' ? 'EUR' : 'USD' },
      task: { projectRate: null, defaultRate: null },
      person: { projectRate: memberRates?.[person] ?? null, rates: company.rates[person] },
    })
    return sum + (resolved.kind === 'rate' ? timeAmount(row.minutes, resolved.rate) : 0)
  }, 0)
}

// Expenses -------------------------------------------------------------------------------------------

const usualAmounts = {
  airfare: [21_000, 58_000], lodging: [11_500, 38_000], meals: [1400, 6800], materials: [2300, 48_000], rental: [9000, 65_000],
} as const

const expenseNotes = {
  mileage: ['Site visit, round trip', 'Drive to the substation', 'Parts pick-up'],
  airfare: ['Flight to the client'],
  lodging: ['Hotel, two nights', 'Hotel during commissioning'],
  meals: ['Lunch on site', 'Dinner while travelling', 'Working lunch with the operators'],
  materials: ['Anchor bolts and grout', 'Cable ties and labels', 'Sensor brackets', 'Survey markers'],
  rental: ['Scissor lift, one day', 'Thermal camera rental', 'Laser level rental'],
}

function addExpenses(
  rows: DemoRows,
  dates: DemoDates,
  choices: Choices,
  company: Company,
  worked: readonly TimeRow[],
): WorkedEntry[] {
  const added: WorkedEntry[] = []
  let receipts = 0
  const weeks = Array.from({ length: historyWeeks + 1 }, (_, index) => dates.week(index - historyWeeks))
  for (const start of weeks) {
    const entries = worked.filter(({ date }) => date >= start && date <= addDays(start, 6))
    const onSite = entries.filter(({ project }) => projectsPlan[project].type !== 'non_billable')
    if (onSite.length === 0) continue
    const chosen = Array.from({ length: 4 }, () => choices.pick(onSite))
    for (const [index, entry] of chosen.entries()) {
      const plan = projectsPlan[entry.project]
      const inEuros = plan.client === 'kestrel'
      const category = inEuros
        ? choices.pick(['airfare', 'lodging', 'meals', 'materials'] as const)
        : choices.pick(['mileage', 'mileage', 'meals', 'materials', 'rental', 'lodging'] as const)
      const miles = category === 'mileage' ? choices.between(120, 1900) * 100 : null
      const [low, high] = category === 'mileage' ? [0, 0] : usualAmounts[category]
      const amount = miles === null ? choices.between(low, high) : expenseAmount(miles, 65_500)
      const reimbursable = choices.chance(70)
      const reimbursement = reimbursementOf(dates, entry)
      const billable = choices.chance(75)
      const id = rows.add(expenses, {
        personId: entry.row.personId, projectId: entry.row.projectId, categoryId: company.categories[category],
        spentOn: entry.date, currency: inEuros ? 'EUR' : 'USD', amount, quantity: miles, unitPrice: miles === null ? null : 65_500,
        notes: choices.pick(expenseNotes[category]), billable, reimbursable,
        reimbursementStatus: reimbursable ? reimbursement : 'none',
        reimbursedOn: reimbursable && reimbursement === 'paid' ? addDays(entry.date, 28) : null, status: entry.status,
        createdBy: entry.row.personId, createdAt: dates.past(entry.date, 18, index),
      })
      added.push({ id, project: entry.project, person: entry.person, date: entry.date, billable, status: entry.status })
      if (category !== 'mileage' && index === 0) {
        receipts++
        const shown = { title: 'DEMO RECEIPT', date: entry.date, amount, currency: inEuros ? 'EUR' : 'USD' }
        const pdf = receipts % 2 === 0
        const content = pdf ? pdfReceipt(shown) : pngReceipt(shown)
        const fileId = rows.add(files, {
          name: `receipt-${entry.date}.${pdf ? 'pdf' : 'png'}`, mediaType: pdf ? 'application/pdf' : 'image/png',
          sizeBytes: content.length, content, ownerId: entry.row.personId, createdAt: dates.past(entry.date, 18, index),
        })
        rows.add(expenseReceipts, { expenseId: id, fileId, createdAt: dates.past(entry.date, 18, index) })
      }
    }
  }
  return added
}

/** Paid back some weeks after approval. */
function reimbursementOf(dates: DemoDates, { status, date }: WorkedEntry) {
  if (status !== 'approved' || date >= dates.week(-2)) return 'pending'
  return date < dates.week(-6) ? 'paid' : 'approved'
}
