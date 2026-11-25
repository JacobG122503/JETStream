/** The fictional people, clients and projects of the demo. */
import type { InferInsertModel } from 'drizzle-orm'
import type { DatedRate } from '../../shared/calc'
import { addDays, type IsoDate } from '../../shared/dates'
import type { BudgetType, ProjectType, RateMethod } from '../../shared/domain'
import {
  clients, contacts, exchangeRates, expenseCategories, labels, people, personClients, personExtras, personLabels, personManagers,
  personRates, projectMembers, projectPins, projects, projectTags, projectTasks, tags, tasks,
} from '../db/schema'
import type { Grants, PermissionKey } from '../../shared/permissions'
import type { DemoDates, DemoRows } from './builder'

export interface RoleIds {
  administrator: number
  manager: number
  member: number
  /** The one custom role of the demo. */
  bookkeeper: number
}

export type PersonKey =
  | 'admin' | 'lead' | 'employee' | 'priya' | 'marcus' | 'elena' | 'tomas' | 'dana' | 'owen' | 'lydia' | 'noah'
export type ProjectKey =
  | 'turbine' | 'substation' | 'pumps' | 'controls' | 'assembly' | 'safety' | 'coldStore' | 'packaging' | 'office'
  | 'training' | 'quarry' | 'boiler'
export type TaskKey =
  | 'design' | 'management' | 'inspection' | 'drafting' | 'commissioning' | 'documentation' | 'meetings' | 'travel'
  | 'administration' | 'training' | 'survey'
export type ClientKey = 'tallgrass' | 'fernhollow' | 'kestrel' | 'lumen' | 'internal' | 'quarry'

const hours = (count: number) => count * 60
const dollars = (amount: number) => amount * 100

export interface DemoPerson {
  key: PersonKey
  id: number
  active: boolean
  archivedOn: IsoDate | null
  manager: PersonKey | null
  /** Usual working day, in minutes. */
  dayMinutes: number
  /** How likely each project is. */
  work: { project: ProjectKey; weight: number }[]
}

/** Switched on for the project lead. */
export const leadExtras: PermissionKey[] = ['time.approve', 'projects.create', 'billable.view']

export const bookkeeper: { name: string; description: string; grants: Grants } = {
  name: 'Bookkeeper',
  description: 'Invoices, payments and reimbursements, without control of people or settings.',
  grants: {
    'clients.view': 'all', 'time.view': 'all', 'billable.view': 'all', 'invoices.manage': 'all', 'payments.manage': 'all',
    'expenses.reimburse': 'all',
  },
}

interface PersonPlan {
  name: string
  email: string
  role: keyof RoleIds
  label: string
  manager: PersonKey | null
  /** Company-currency billable and cost rate per hour, in dollars. */
  rate: number
  cost: number
  work: Partial<Record<ProjectKey, number>>
  kind?: 'contractor'
  dayMinutes?: number
}

const peoplePlan: Record<PersonKey, PersonPlan> = {
  admin: {
    name: 'Avery Collins', email: 'admin@jet.demo', role: 'administrator', label: 'Billing', manager: null, rate: 95,
    cost: 48, work: { office: 8, training: 1, packaging: 1 },
  },
  lead: {
    name: 'Jordan Blake', email: 'lead@jet.demo', role: 'manager', label: 'Project lead', manager: 'admin', rate: 145,
    cost: 72, work: { turbine: 4, substation: 2, pumps: 3, coldStore: 3, office: 1 },
  },
  employee: {
    name: 'Casey Lindgren', email: 'employee@jet.demo', role: 'member', label: 'Engineer', manager: 'lead', rate: 110,
    cost: 52, work: { turbine: 4, substation: 3, pumps: 3, coldStore: 2, training: 1 },
  },
  priya: {
    name: 'Priya Venkat', email: 'priya.venkat@jet.example', role: 'manager', label: 'Project lead', manager: 'admin',
    rate: 140, cost: 70, work: { controls: 4, assembly: 4, safety: 2, packaging: 1, office: 1 },
  },
  marcus: {
    name: 'Marcus Oyelaran', email: 'marcus.oyelaran@jet.example', role: 'member', label: 'Engineer', manager: 'lead',
    rate: 115, cost: 56, work: { turbine: 4, pumps: 3, coldStore: 3, quarry: 2, training: 1 },
  },
  elena: {
    name: 'Elena Marchetti', email: 'elena.marchetti@jet.example', role: 'bookkeeper', label: 'Engineer', manager: 'priya',
    rate: 118, cost: 57, work: { controls: 4, assembly: 4, safety: 3, training: 1 },
  },
  tomas: {
    name: 'Tomas Brennan', email: 'tomas.brennan@jet.example', role: 'member', label: 'Technician', manager: 'lead',
    rate: 88, cost: 41, work: { substation: 5, pumps: 3, coldStore: 2, training: 1 },
  },
  dana: {
    name: 'Dana Whitlock', email: 'dana.whitlock@contractors.example', role: 'member', label: 'Technician',
    manager: 'priya', rate: 98, cost: 64, work: { controls: 4, safety: 3, assembly: 3 }, kind: 'contractor',
    dayMinutes: hours(6),
  },
  owen: {
    name: 'Owen Sutherby', email: 'owen.sutherby@jet.example', role: 'member', label: 'Drafter', manager: 'lead',
    rate: 82, cost: 38, work: { turbine: 4, coldStore: 3, pumps: 2, quarry: 1, training: 1 },
  },
  lydia: {
    name: 'Lydia Farrow', email: 'lydia.farrow@jet.example', role: 'member', label: 'Surveyor', manager: 'lead',
    rate: 92, cost: 44, work: { quarry: 5, turbine: 2, office: 1 },
  },
  noah: {
    name: 'Noah Pemberly', email: 'noah.pemberly@jet.example', role: 'member', label: '', manager: null, rate: 0, cost: 0,
    work: {},
  },
}

const tasksPlan: Record<TaskKey, Partial<InferInsertModel<typeof tasks>> & { name: string }> = {
  design: { name: 'Engineering design', defaultRate: dollars(125), common: true },
  management: { name: 'Project management', defaultRate: dollars(130), common: true },
  inspection: { name: 'Site inspection', defaultRate: dollars(115) },
  drafting: { name: 'CAD drafting', defaultRate: dollars(85) },
  commissioning: { name: 'Commissioning', defaultRate: dollars(128) },
  documentation: { name: 'Documentation', defaultRate: dollars(80), common: true },
  meetings: { name: 'Meetings', billableByDefault: false, common: true },
  travel: { name: 'Travel', defaultRate: dollars(60) },
  administration: { name: 'Administration', billableByDefault: false },
  training: { name: 'Training', billableByDefault: false },
  survey: { name: 'Land survey', defaultRate: dollars(90) },
}

const notesFor: Record<TaskKey, string[]> = {
  design: [
    'Load calculations for the revised layout', 'Checked bolt pattern against supplier data', 'Design review comments worked in',
    'Compared two layout options', 'Updated calculation package', 'Pipe stress check on the north run',
  ],
  management: [
    'Weekly progress call and action list', 'Updated schedule and cost forecast', 'Prepared client status report',
    'Coordinated supplier delivery dates',
  ],
  inspection: [
    'Walked the site with the operations crew', 'Thermal scan and photo record', 'Checked anchor bolts and grout',
    'Punch list follow-up', 'Measured clearances for the new equipment',
  ],
  drafting: [
    'Drawing set revision B', 'General arrangement drawing', 'Red-line corrections', 'Section details and bill of materials',
  ],
  commissioning: ['Loop checks with operators', 'Motor rotation tests', 'Start-up support', 'Tuned control parameters'],
  documentation: ['Wrote operating instructions', 'Inspection report', 'Updated equipment data sheets', 'As-built record'],
  meetings: ['Internal coordination', 'Design stand-up', 'Kick-off preparation'],
  travel: ['Drive to site', 'Return from site'],
  administration: ['Invoicing and bookkeeping', 'Purchase orders', 'Filed supplier documents', 'Payroll preparation', 'Resource planning'],
  training: ['Safety refresher', 'New design software', 'First-aid course'],
  survey: ['Set out survey points', 'Processed point cloud', 'Boundary check'],
}

interface ProjectPlan {
  client: ClientKey
  name: string
  code: string
  type: ProjectType
  rateMethod: RateMethod
  /** Project rate, in the client's currency. */
  rate?: number
  fixedFee?: number
  budgetType: BudgetType
  manager: PersonKey
  tasks: Partial<Record<TaskKey, { weight: number; rate?: number; budgetAmount?: number }>>
  memberRates?: Partial<Record<PersonKey, number>>
  startWeek: number
  endWeek?: number
  more?: Partial<InferInsertModel<typeof projects>>
}

export const quarryLastWeek = -13

export const projectsPlan: Record<ProjectKey, ProjectPlan> = {
  turbine: {
    client: 'tallgrass', name: 'Turbine foundation design', code: 'TGW-101', type: 'time_materials', rateMethod: 'person',
    budgetType: 'total_fees', manager: 'lead',
    tasks: {
      design: { weight: 5 }, drafting: { weight: 3 }, management: { weight: 1 }, documentation: { weight: 1 },
      meetings: { weight: 1 },
    },
    startWeek: -30, endWeek: 10, more: { budgetAlertPercent: 80_000, budgetVisibleToAll: true },
  },
  substation: {
    client: 'tallgrass', name: 'Substation inspections', code: 'TGW-102', type: 'time_materials', rateMethod: 'project',
    rate: dollars(135), budgetType: 'total_hours', manager: 'lead',
    tasks: { inspection: { weight: 5 }, documentation: { weight: 2 }, travel: { weight: 1 } },
    startWeek: -40, more: { budgetMonthly: true, budgetAlertPercent: 90_000 },
  },
  pumps: {
    client: 'fernhollow', name: 'Pump station upgrade', code: 'FWU-201', type: 'time_materials', rateMethod: 'task',
    budgetType: 'hours_per_task', manager: 'lead',
    tasks: {
      design: { weight: 4, rate: dollars(132) }, drafting: { weight: 2 }, inspection: { weight: 2 },
      commissioning: { weight: 2 }, management: { weight: 1 }, meetings: { weight: 1 },
    },
    startWeek: -28, endWeek: 14, more: { budgetAlertPercent: 85_000 },
  },
  controls: {
    client: 'fernhollow', name: 'Control system integration', code: 'FWU-202', type: 'fixed_fee', rateMethod: 'none',
    fixedFee: dollars(86_000), budgetType: 'fees_per_task', manager: 'priya',
    tasks: {
      design: { weight: 4, budgetAmount: dollars(40_000) }, commissioning: { weight: 3, budgetAmount: dollars(34_000) },
      documentation: { weight: 1, budgetAmount: dollars(12_000) },
    },
    startWeek: -27, endWeek: 6,
  },
  assembly: {
    client: 'kestrel', name: 'Assembly line retrofit', code: 'KES-301', type: 'time_materials', rateMethod: 'project',
    rate: dollars(118), budgetType: 'total_fees', manager: 'priya',
    tasks: { design: { weight: 4 }, commissioning: { weight: 2 }, drafting: { weight: 1 }, management: { weight: 1 } },
    startWeek: -32, endWeek: 8, more: { budgetIncludesExpenses: true, budgetAlertPercent: 80_000 },
  },
  safety: {
    client: 'kestrel', name: 'Machine safety review', code: 'KES-302', type: 'time_materials', rateMethod: 'person',
    budgetType: 'hours_per_person', manager: 'priya',
    tasks: { inspection: { weight: 3 }, documentation: { weight: 2 }, meetings: { weight: 1 } },
    memberRates: { priya: dollars(128), elena: dollars(110), dana: dollars(96) }, startWeek: -26,
  },
  coldStore: {
    client: 'lumen', name: 'Cold store expansion', code: 'LRF-401', type: 'time_materials', rateMethod: 'project',
    rate: dollars(128), budgetType: 'total_hours', manager: 'lead',
    tasks: { design: { weight: 4 }, drafting: { weight: 2 }, inspection: { weight: 2 }, management: { weight: 1 } },
    startWeek: -29, endWeek: 4, more: { budgetAlertPercent: 80_000, budgetVisibleToAll: true },
  },
  packaging: {
    client: 'lumen', name: 'Packaging line study', code: 'LRF-402', type: 'time_materials', rateMethod: 'none',
    budgetType: 'none', manager: 'priya', tasks: { design: { weight: 2 }, documentation: { weight: 1 } }, startWeek: -26,
  },
  office: {
    client: 'internal', name: 'Company administration', code: 'JET-001', type: 'non_billable', rateMethod: 'none',
    budgetType: 'none', manager: 'admin', tasks: { administration: { weight: 4 }, meetings: { weight: 1 } }, startWeek: -100,
  },
  training: {
    client: 'internal', name: 'Training and safety', code: 'JET-002', type: 'non_billable', rateMethod: 'none',
    budgetType: 'total_hours', manager: 'admin', tasks: { training: { weight: 1 } }, startWeek: -100,
    more: { budgetMinutes: hours(800) },
  },
  quarry: {
    client: 'quarry', name: 'Conveyor route survey', code: 'OQM-601', type: 'time_materials', rateMethod: 'project',
    rate: dollars(105), budgetType: 'total_hours', manager: 'lead',
    tasks: { survey: { weight: 4 }, drafting: { weight: 2 }, documentation: { weight: 1 } },
    startWeek: -34, endWeek: quarryLastWeek, more: { budgetMinutes: hours(2000) },
  },
  // Made from an accepted estimate; work has not begun.
  boiler: {
    client: 'lumen', name: 'Boiler replacement', code: 'LRF-403', type: 'fixed_fee', rateMethod: 'task',
    fixedFee: dollars(40_375), budgetType: 'total_fees', manager: 'priya',
    tasks: { design: { weight: 1 }, commissioning: { weight: 1 }, management: { weight: 1 } },
    startWeek: 1, endWeek: 16, more: { budgetAmount: dollars(40_375) },
  },
}

/** Everyone helps on these. */
const openProjects: ProjectKey[] = ['office', 'training']

export interface Company {
  people: Record<PersonKey, DemoPerson>
  clients: Record<ClientKey, number>
  tasks: Record<TaskKey, number>
  projects: Record<ProjectKey, number>
  projectTasks: Record<ProjectKey, { key: TaskKey; id: number; weight: number; billable: boolean }[]>
  categories: Record<'mileage' | 'airfare' | 'lodging' | 'meals' | 'materials' | 'rental', number>
  /** Dated billable rates, in company currency. */
  rates: Record<PersonKey, DatedRate[]>
  notesFor: Record<TaskKey, string[]>
}

/** Budgets that depend on the time worked; filled in later through `projectRow` and so on. */
export interface BudgetRows {
  projectRow: (key: ProjectKey) => InferInsertModel<typeof projects>
  taskRow: (id: number) => InferInsertModel<typeof projectTasks>
  memberRow: (project: ProjectKey, person: PersonKey) => InferInsertModel<typeof projectMembers>
}

export function addCompany(rows: DemoRows, dates: DemoDates, roles: RoleIds): Company & BudgetRows {
  const keysOf = <K extends string>(plan: Partial<Record<K, unknown>>) => Object.keys(plan) as K[]
  const archivedOn = dates.week(-11, 4)

  const person = {} as Record<PersonKey, DemoPerson>
  for (const [index, key] of keysOf(peoplePlan).entries()) {
    const plan = peoplePlan[key]
    const status = key === 'lydia' ? 'archived' : key === 'noah' ? 'pending' : 'active'
    const id = rows.add(people, {
      name: plan.name,
      email: plan.email,
      phone: `(312) 555-01${String(10 + index)}`,
      status,
      kind: plan.kind ?? 'employee',
      roleId: roles[plan.role],
      weeklyCapacityMinutes: (plan.dayMinutes ?? hours(8)) * 5,
      startedOn: key === 'noah' ? null : dates.week(-60 - index * 9),
      archivedOn: status === 'archived' ? archivedOn : null,
      createdAt: status === 'pending' ? dates.past(dates.daysFromToday(-2), 9) : dates.past(dates.week(-60 - index * 9), 9),
    })
    const work = keysOf(plan.work).map((project) => ({ project, weight: plan.work[project] ?? 0 }))
    person[key] = {
      key, id, active: status === 'active', archivedOn: status === 'archived' ? archivedOn : null, manager: plan.manager,
      dayMinutes: plan.dayMinutes ?? hours(8), work,
    }
  }

  for (const permission of leadExtras) rows.add(personExtras, { personId: person.lead.id, permission })

  const labelIds = new Map<string, number>()
  const rates = {} as Record<PersonKey, DatedRate[]>
  for (const key of keysOf(peoplePlan)) {
    const { label, manager, rate, cost } = peoplePlan[key]
    const personId = person[key].id
    if (label && !labelIds.has(label)) labelIds.set(label, rows.add(labels, { name: label }))
    const labelId = labelIds.get(label)
    if (labelId !== undefined) rows.add(personLabels, { personId, labelId })
    if (manager) rows.add(personManagers, { personId, managerId: person[manager].id })
    rates[key] = []
    if (rate === 0) continue
    const addRates = (startsOn: IsoDate, billableRate: number, costRate: number) => {
      rates[key].push({ startsOn, rate: dollars(billableRate) })
      rows.add(personRates, { personId, kind: 'billable', startsOn, rate: dollars(billableRate) })
      rows.add(personRates, { personId, kind: 'cost', startsOn, rate: dollars(costRate) })
    }
    addRates(dates.week(-60), rate, cost)
    // Raises part-way through the demo's history.
    if (key === 'employee' || key === 'marcus' || key === 'owen') addRates(dates.week(-12), rate + 8, cost + 4)
  }

  const client: Record<ClientKey, number> = {
    tallgrass: rows.add(clients, {
      name: 'Tallgrass Wind Cooperative', address: '410 Prairie View Road\nSuite 12\nMillbrook, IL 60000', currency: 'USD',
      tax1Name: 'Sales tax', tax1Percent: 6250, paymentTerms: 'net_30', notes: 'Wants purchase order numbers on invoices.',
      createdAt: dates.past(dates.week(-52), 9),
    }),
    fernhollow: rows.add(clients, {
      name: 'Fernhollow Water Utility', address: '77 Reservoir Lane\nFernhollow, WI 53000', currency: 'USD',
      tax1Name: 'State tax', tax1Percent: 5000, tax2Name: 'County tax', tax2Percent: 500, paymentTerms: 'net_30',
      createdAt: dates.past(dates.week(-50), 9),
    }),
    kestrel: rows.add(clients, {
      name: 'Kestrel Maschinenbau GmbH', address: 'Beispielstrasse 4\n00000 Musterstadt\nGermany', currency: 'EUR',
      paymentTerms: 'net_30', createdAt: dates.past(dates.week(-48), 9),
    }),
    lumen: rows.add(clients, {
      name: 'Lumen Ridge Foods', address: '2300 Orchard Parkway\nLumen Ridge, IA 50000', currency: 'USD',
      discountPercent: 5000, paymentTerms: 'custom', paymentTermDays: 21, createdAt: dates.past(dates.week(-45), 9),
    }),
    internal: rows.add(clients, {
      name: 'JET Engineering (internal)', currency: 'USD', paymentTerms: 'upon_receipt',
      notes: 'Our own time that is not for a client.', createdAt: dates.past(dates.week(-100), 9),
    }),
    quarry: rows.add(clients, {
      name: 'Old Quarry Materials', address: '9 Gravel Pit Road\nStonefield, MO 63000', currency: 'USD',
      archivedAt: dates.past(dates.week(-7), 11), createdAt: dates.past(dates.week(-54), 9),
    }),
  }
  const contact = (clientId: number, name: string, title: string, email: string, line: number) =>
    rows.add(contacts, {
      clientId, name, title, email, officePhone: `(414) 555-01${line}`, mobilePhone: line % 2 ? `(414) 555-01${line + 20}` : null,
    })
  contact(client.tallgrass, 'Renata Holm', 'Plant manager', 'renata.holm@tallgrass.example', 40)
  contact(client.tallgrass, 'Gil Abara', 'Accounts payable', 'payables@tallgrass.example', 41)
  contact(client.fernhollow, 'Samir Dewitt', 'Operations director', 'samir.dewitt@fernhollow.example', 42)
  contact(client.kestrel, 'Anke Vollmer', 'Einkauf', 'anke.vollmer@kestrel.example', 43)
  contact(client.lumen, 'Bea Castellan', 'Facilities engineer', 'bea.castellan@lumenridge.example', 44)
  contact(client.internal, 'Avery Collins', 'Office', 'office@jet.example', 45)
  contact(client.quarry, 'Hollis Drummond', 'Owner', 'hollis@oldquarry.example', 46)

  for (const [weeks, rate] of [[-60, 1_092_000], [-20, 1_078_500], [-8, 1_084_250]] as const) {
    rows.add(exchangeRates, { fromCurrency: 'EUR', toCurrency: 'USD', startsOn: dates.week(weeks), rate })
  }

  const task = {} as Record<TaskKey, number>
  for (const key of keysOf(tasksPlan)) {
    task[key] = rows.add(tasks, {
      ...tasksPlan[key], archivedAt: key === 'survey' ? dates.past(dates.week(-7), 11) : null,
      createdAt: dates.past(dates.week(-100), 9),
    })
  }

  const project = {} as Record<ProjectKey, number>
  const projectTask = {} as Company['projectTasks']
  const projectRows = {} as Record<ProjectKey, InferInsertModel<typeof projects>>
  const taskRows = new Map<number, InferInsertModel<typeof projectTasks>>()
  const memberRows = new Map<string, InferInsertModel<typeof projectMembers>>()
  for (const key of keysOf(projectsPlan)) {
    const plan = projectsPlan[key]
    projectRows[key] = {
      clientId: client[plan.client], name: plan.name, code: plan.code, type: plan.type, rateMethod: plan.rateMethod,
      rate: plan.rate ?? null, fixedFee: plan.fixedFee ?? null, budgetType: plan.budgetType,
      startsOn: dates.week(plan.startWeek), endsOn: plan.endWeek === undefined ? null : dates.week(plan.endWeek, 4),
      archivedAt: key === 'quarry' ? dates.past(dates.week(-7), 11) : null,
      createdAt: dates.past(dates.week(Math.min(plan.startWeek, -1) - 1), 10), ...plan.more,
    }
    project[key] = rows.add(projects, projectRows[key])
    projectTask[key] = keysOf(plan.tasks).map((taskKey) => {
      const { weight = 1, rate = null, budgetAmount = null } = plan.tasks[taskKey] ?? {}
      const billable = plan.type !== 'non_billable' && (tasksPlan[taskKey].billableByDefault ?? true)
      const row = { projectId: project[key], taskId: task[taskKey], billable, rate, budgetAmount }
      const id = rows.add(projectTasks, row)
      taskRows.set(id, row)
      return { key: taskKey, id, weight, billable }
    })
    for (const personKey of keysOf(peoplePlan)) {
      const isManager = plan.manager === personKey
      const works =
        key in peoplePlan[personKey].work || openProjects.includes(key) || (key === 'boiler' && personKey === 'elena')
      if (personKey === 'noah' || (!isManager && !works)) continue
      const row = {
        projectId: project[key], personId: person[personKey].id, isManager, rate: plan.memberRates?.[personKey] ?? null,
      }
      rows.add(projectMembers, row)
      memberRows.set(`${key}/${personKey}`, row)
    }
  }
  for (const personKey of keysOf(peoplePlan)) {
    const assigned = keysOf(projectsPlan)
      .filter((key) => memberRows.has(`${key}/${personKey}`))
      .map((key) => client[projectsPlan[key].client])
    for (const clientId of new Set(assigned)) rows.add(personClients, { personId: person[personKey].id, clientId })
  }

  const tagIds = ['Energy', 'Water', 'Food', 'Field work'].map((name) => rows.add(tags, { name }))
  const tagged: [ProjectKey, number][] = [
    ['turbine', 0], ['substation', 0], ['substation', 3], ['pumps', 1], ['controls', 1], ['coldStore', 2], ['quarry', 3],
  ]
  for (const [key, tag] of tagged) rows.add(projectTags, { projectId: project[key], tagId: tagIds[tag] ?? 1 })
  for (const key of ['turbine', 'coldStore'] as const) {
    rows.add(projectPins, { personId: person.lead.id, projectId: project[key] })
  }
  rows.add(projectPins, { personId: person.employee.id, projectId: project.substation })

  const categories = {
    mileage: rows.add(expenseCategories, { name: 'Mileage', unitName: 'mile', unitPrice: 65_500 }),
    airfare: rows.add(expenseCategories, { name: 'Airfare' }),
    lodging: rows.add(expenseCategories, { name: 'Lodging' }),
    meals: rows.add(expenseCategories, { name: 'Meals' }),
    materials: rows.add(expenseCategories, { name: 'Materials' }),
    rental: rows.add(expenseCategories, { name: 'Equipment rental' }),
  }
  rows.add(expenseCategories, { name: 'Fax', archivedAt: dates.past(dates.week(-40), 9) })

  return {
    people: person, clients: client, tasks: task, projects: project, projectTasks: projectTask, categories, rates,
    notesFor,
    projectRow: (key) => projectRows[key],
    taskRow: (id) => found(taskRows.get(id)),
    memberRow: (projectKey, personKey) => found(memberRows.get(`${projectKey}/${personKey}`)),
  }
}

function found<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('The demo plan refers to something that is not in it.')
  return value
}

/** The weekday's holidays observed in a US office, for every year the demo touches. */
export function holidaysFor(years: readonly number[]): { observedOn: IsoDate; name: string }[] {
  const pad = (value: number) => String(value).padStart(2, '0')
  const dayOfWeek = (date: IsoDate) => new Date(`${date}T00:00:00Z`).getUTCDay()
  /** The nth weekday of a month; 1 is Monday. */
  const nth = (year: number, month: number, weekday: number, n: number): IsoDate => {
    const first = `${year}-${pad(month)}-01`
    return addDays(first, ((weekday - dayOfWeek(first) + 7) % 7) + (n - 1) * 7)
  }
  const lastMonday = (year: number, month: number): IsoDate => {
    const fifth = nth(year, month, 1, 5)
    return fifth.slice(0, 7) === `${year}-${pad(month)}` ? fifth : addDays(fifth, -7)
  }
  /** Saturday holidays move to Friday, Sunday ones to Monday. */
  const observed = (date: IsoDate) => addDays(date, dayOfWeek(date) === 6 ? -1 : dayOfWeek(date) === 0 ? 1 : 0)
  return years
    .flatMap((year) => [
      { observedOn: observed(`${year}-01-01`), name: "New Year's Day" },
      { observedOn: lastMonday(year, 5), name: 'Memorial Day' },
      { observedOn: observed(`${year}-07-04`), name: 'Independence Day' },
      { observedOn: nth(year, 9, 1, 1), name: 'Labor Day' },
      { observedOn: nth(year, 11, 4, 4), name: 'Thanksgiving' },
      { observedOn: addDays(nth(year, 11, 4, 4), 1), name: 'Day after Thanksgiving' },
      { observedOn: observed(`${year}-12-25`), name: 'Christmas Day' },
    ])
    .sort((a, b) => a.observedOn.localeCompare(b.observedOn))
}
