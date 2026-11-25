import { describe, expect, it } from 'vitest'
import { approvalView, lockState, noFilter } from './approvals'
import { periodCapacity } from './calc'
import { addDays, startOfWeek } from './dates'
import type { ApprovalLine, ApprovalPerson, ApprovalProject } from './work'

const person = (id: number, name: string, more: Partial<ApprovalPerson> = {}): ApprovalPerson => ({
  id, name, photoId: null, department: '', labels: [], missing: false, canSubmit: false, canRemind: true, approved: [], ...more,
})
const people = [person(1, 'Zoe', { missing: true, department: 'Office' }), person(2, 'Ana', { labels: ['Engineer'], department: 'Engineering' }), person(3, 'Max', { missing: true })]
const projects: ApprovalProject[] = [
  { id: 10, name: 'Pumps', client: { id: 100, name: 'Water' }, tags: ['Field work'] },
  { id: 11, name: 'Pipes', client: { id: 100, name: 'Water' }, tags: [] },
  { id: 12, name: 'Office', client: { id: 101, name: 'Internal' }, tags: [] },
]
const line = (personId: number, projectId: number, minutes: number, billableMinutes: number, more: Partial<ApprovalLine> = {}): ApprovalLine => ({
  personId, projectId, status: 'open', minutes, billableMinutes, expenses: [], ...more,
})
const lines = [
  line(2, 10, 600, 600, { expenses: [{ currency: 'USD', billable: 17_690, other: 0 }] }),
  line(2, 11, 60, 0, { expenses: [{ currency: 'USD', billable: 0, other: 500 }, { currency: 'EUR', billable: 100, other: 0 }] }),
  line(1, 12, 120, 0),
  line(1, 10, 999, 999, { status: 'approved' }),
]
const data = { people, projects, lines }

describe('the view of approvals', () => {
  it('lists people by name with their sums, and those who did nothing while something is missing', () => {
    const { rows, total } = approvalView(data, 'open', 'person')
    expect(rows.map(({ name, minutes, billableMinutes }) => [name, minutes, billableMinutes])).toEqual([['Ana', 660, 600], ['Max', 0, 0], ['Zoe', 120, 0]])
    expect(total).toEqual({
      minutes: 780, billableMinutes: 600, billableExpenses: [{ currency: 'EUR', amount: 100 }, { currency: 'USD', amount: 17_690 }], otherExpenses: [{ currency: 'USD', amount: 500 }],
    })
    expect(approvalView(data, 'approved', 'person').rows.map(({ name, minutes }) => [name, minutes])).toEqual([['Zoe', 999]])
    expect(approvalView(data, 'submitted', 'person')).toEqual({ rows: [], total: { minutes: 0, billableMinutes: 0, billableExpenses: [], otherExpenses: [] } })
  })

  it('groups by project and client', () => {
    expect(approvalView(data, 'open', 'project').rows.map(({ name, minutes, personIds }) => [name, minutes, personIds])).toEqual([['Office', 120, [1]], ['Pipes', 60, [2]], ['Pumps', 600, [2]]])
    expect(approvalView(data, 'open', 'client').rows.map(({ name, minutes }) => [name, minutes])).toEqual([['Internal', 120], ['Water', 660]])
  })

  it('filters; who did nothing fits no choice of projects', () => {
    const names = (filter: Partial<typeof noFilter>) => approvalView(data, 'open', 'person', { ...noFilter, ...filter }).rows.map(({ name }) => name)
    expect(names({ clients: [100] })).toEqual(['Ana'])
    expect(names({ projects: [12] })).toEqual(['Zoe'])
    expect(names({ tags: ['Field work'] })).toEqual(['Ana'])
    expect(names({ departments: ['Office'] })).toEqual(['Zoe'])
    expect(names({ labels: ['Engineer'] })).toEqual(['Ana'])
    expect(names({ people: [3] })).toEqual(['Max'])
    expect(approvalView(data, 'open', 'person', { ...noFilter, projects: [10] }).total.minutes).toBe(600)
  })
})

it('knows whether a period is locked', () => {
  const state = (through: string | null, afterDays: number | null, today = '2026-11-25') =>
    lockState({ to: '2026-11-20', today, lock: { through, afterDays } }, (date) => addDays(startOfWeek(date, 6), 6), addDays)
  expect([state(null, null), state('2026-11-20', null), state('2026-11-19', null), state(null, 4), state(null, 5)]).toEqual(['open', 'locked', 'partly', 'locked', 'partly'])
})

it('the working time of a period goes by its days', () => {
  expect([periodCapacity(2400, '2026-11-21', '2026-11-27'), periodCapacity(2400, '2026-11-01', '2026-11-30'), periodCapacity(0, '2026-11-01', '2026-11-30')]).toEqual([2400, 10_286, 0])
})
