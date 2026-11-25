/** What the Approvals page shows of a period. Pure. */
import type { ApprovalLine, ApprovalPerson, Approvals, ApprovalStatus } from './work'

export type ApprovalGroup = 'person' | 'project' | 'client'

/** Nothing chosen means everything. */
export interface ApprovalFilter {
  clients: readonly number[]
  projects: readonly number[]
  labels: readonly string[]
  departments: readonly string[]
  tags: readonly string[]
  people: readonly number[]
}

export interface Amount {
  currency: string
  amount: number
}

export interface ApprovalSums {
  minutes: number
  billableMinutes: number
  billableExpenses: Amount[]
  otherExpenses: Amount[]
}

export interface ApprovalRow extends ApprovalSums {
  id: number
  name: string
  /** Of a row for a person. */
  person?: ApprovalPerson
  /** Whose time is in it. */
  personIds: number[]
}

export interface ApprovalView {
  rows: ApprovalRow[]
  total: ApprovalSums
}

export const noFilter: ApprovalFilter = { clients: [], projects: [], labels: [], departments: [], tags: [], people: [] }

const among = <T>(chosen: readonly T[], value: T) => chosen.length === 0 || chosen.includes(value)
const anyAmong = <T>(chosen: readonly T[], values: readonly T[]) => chosen.length === 0 || values.some((value) => chosen.includes(value))

function addAmounts(lines: readonly ApprovalLine[], of: 'billable' | 'other'): Amount[] {
  const sums = new Map<string, number>()
  for (const { expenses } of lines) for (const { currency, [of]: amount } of expenses) sums.set(currency, (sums.get(currency) ?? 0) + amount)
  return [...sums].filter(([, amount]) => amount !== 0).map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency))
}

const sumsOf = (lines: readonly ApprovalLine[]): ApprovalSums => ({
  minutes: lines.reduce((sum, { minutes }) => sum + minutes, 0),
  billableMinutes: lines.reduce((sum, { billableMinutes }) => sum + billableMinutes, 0),
  billableExpenses: addAmounts(lines, 'billable'),
  otherExpenses: addAmounts(lines, 'other'),
})

export function approvalView(
  { people, projects, lines }: Pick<Approvals, 'people' | 'projects' | 'lines'>, status: ApprovalStatus, group: ApprovalGroup, filter: ApprovalFilter = noFilter,
): ApprovalView {
  const shownPeople = people.filter(
    ({ id, labels, department }) => among(filter.people, id) && anyAmong(filter.labels, labels) && among(filter.departments, department),
  )
  const shownProjects = projects.filter(({ id, client, tags }) => among(filter.projects, id) && among(filter.clients, client.id) && anyAmong(filter.tags, tags))
  const personIds = new Set(shownPeople.map(({ id }) => id))
  const projectIds = new Set(shownProjects.map(({ id }) => id))
  const shown = lines.filter((line) => line.status === status && personIds.has(line.personId) && projectIds.has(line.projectId))
  // Who has done nothing is on no project, so cannot fit a choice of them.
  const everyProject = filter.clients.length + filter.projects.length + filter.tags.length === 0

  const row = (id: number, name: string, part: ApprovalLine[], person?: ApprovalPerson): ApprovalRow => ({
    id, name, ...(person && { person }), personIds: person ? [person.id] : [...new Set(part.map(({ personId }) => personId))], ...sumsOf(part),
  })
  let rows: ApprovalRow[]
  if (group === 'person') {
    rows = shownPeople
      .map((person) => ({ person, part: shown.filter(({ personId }) => personId === person.id) }))
      .filter(({ person, part }) => part.length > 0 || (status === 'open' && everyProject && person.missing))
      .map(({ person, part }) => row(person.id, person.name, part, person))
  } else {
    const named = group === 'project' ? shownProjects : [...new Map(shownProjects.map(({ client }) => [client.id, client])).values()]
    const groupOf = new Map(shownProjects.map(({ id, client }) => [id, group === 'project' ? id : client.id]))
    rows = named
      .map(({ id, name }) => row(id, name, shown.filter(({ projectId }) => groupOf.get(projectId) === id)))
      .filter(({ personIds: some }) => some.length > 0)
  }
  return { rows: rows.sort((a, b) => a.name.localeCompare(b.name)), total: sumsOf(shown) }
}

/** Whether everything up to a date is closed by a lock, and until when. */
export function lockState({ to, today, lock: { through, afterDays } }: Pick<Approvals, 'to' | 'today' | 'lock'>, weekEnd: (date: string) => string, plus: (date: string, days: number) => string) {
  if (through !== null && through >= to) return 'locked' as const
  if (afterDays !== null && plus(weekEnd(to), afterDays) < today) return 'locked' as const
  return through !== null || afterDays !== null ? ('partly' as const) : ('open' as const)
}
