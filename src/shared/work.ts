/** What the server's API sends about time, projects, clients, expenses, invoices and reports. */
import type { IsoDate } from './dates'
import type { BudgetType, EntryStatus, InvoiceStatus, PaymentMethod, ProjectType, RateMethod } from './domain'

export interface Named {
  id: number
  name: string
}

export interface TimeEntry {
  id: number
  version: number
  projectId: number
  project: string
  projectCode: string
  client: string
  taskId: number
  task: string
  spentOn: IsoDate
  /** Without the time of a running timer. */
  minutes: number
  /** Set while the timer runs. */
  timerStartedAt: string | null
  notes: string
  billable: boolean
  status: EntryStatus
  /** Why it cannot be changed; null when it can. */
  locked: 'invoiced' | 'approved' | 'period' | null
}

export interface TimeProject {
  id: number
  name: string
  code: string
  client: string
  tasks: (Named & { billable: boolean })[]
}

export interface TimeWeek {
  from: IsoDate
  to: IsoDate
  today: IsoDate
  /** Usual working time of a week. */
  capacityMinutes: number
  entries: TimeEntry[]
  /** How the week stands; null while it has not been handed in. */
  submission: { status: 'submitted' | 'approved' | 'rejected'; comment: string } | null
  running: TimeEntry | null
  /** The server's clock, to show a running timer right. */
  now: string
}

export interface TimeInput {
  projectId: number
  taskId: number
  spentOn: IsoDate
  minutes: number
  notes: string
}

/** Part of a budget that is used up. Amounts are minor units of the project's currency, hours minutes. */
export interface Budget {
  unit: 'hours' | 'fees'
  used: number
  total: number
  monthly: boolean
  alertPercent: number | null
}

export interface ProjectRow {
  id: number
  name: string
  code: string
  client: Named
  currency: string
  type: ProjectType
  startsOn: IsoDate | null
  endsOn: IsoDate | null
  archived: boolean
  minutes: number
  billableMinutes: number
  budget: Budget | null
  members: (Named & { photoId: number | null; isManager: boolean })[]
}

export interface ProjectTaskRow extends Named {
  billable: boolean
  minutes: number
  budgetMinutes: number | null
  billableAmount?: number
}

export interface ProjectPersonRow extends Named {
  photoId: number | null
  isManager: boolean
  minutes: number
  budgetMinutes: number | null
  billableAmount?: number
}

export interface WeekPoint {
  from: IsoDate
  billable: number
  other: number
}

export interface ProjectDetails extends ProjectRow {
  notes: string
  rateMethod: RateMethod
  budgetType: BudgetType
  weeks: WeekPoint[]
  tasks: ProjectTaskRow[]
  people: ProjectPersonRow[]
  /** Only for those who may see billable amounts. */
  billableAmount?: number
  unbilledAmount?: number
  fixedFee?: number | null
  rate?: number | null
}

export interface ProjectOptions {
  clients: (Named & { currency: string })[]
  tasks: (Named & { common: boolean; billable: boolean })[]
  people: Named[]
  /** Whether rates and fees may be set. */
  money: boolean
}

export interface ClientRow extends Named {
  currency: string
  archived: boolean
  activeProjects: number
  contacts: number
  minutes: number
}

export interface ClientDetails extends ClientRow {
  address: string
  notes: string
  contactList: { id: number; name: string; title: string; email: string | null; officePhone: string | null; mobilePhone: string | null }[]
  projects: ProjectRow[]
  /** Only for those who handle invoices. */
  invoices?: InvoiceRow[]
}

export interface ExpenseRow {
  id: number
  version: number
  projectId: number
  project: string
  client: string
  categoryId: number
  category: string
  spentOn: IsoDate
  currency: string
  amount: number
  quantity: number | null
  notes: string
  billable: boolean
  reimbursable: boolean
  reimbursementStatus: string
  status: EntryStatus
  locked: 'invoiced' | 'approved' | 'period' | null
}

export interface ExpenseOptions {
  projects: (Named & { code: string; client: string; currency: string; billable: boolean })[]
  categories: (Named & { unitName: string | null; unitPrice: number | null })[]
}

export interface ExpenseInput {
  projectId: number
  categoryId: number
  spentOn: IsoDate
  /** Minor units. Not used for categories with a unit. */
  amount: number
  /** Thousandths, for categories with a unit. */
  quantity: number | null
  notes: string
  billable: boolean
  reimbursable: boolean
}

export interface InvoiceRow {
  id: number
  number: string
  client: Named
  subject: string
  status: InvoiceStatus
  issuedOn: IsoDate
  dueOn: IsoDate
  late: boolean
  currency: string
  total: number
  dueAmount: number
}

export interface InvoiceList {
  today: IsoDate
  invoices: InvoiceRow[]
}

export interface InvoiceDetails extends InvoiceRow {
  version: number
  company: { name: string; address: string }
  clientAddress: string
  purchaseOrder: string
  notes: string
  lines: { id: number; description: string; quantity: number; unitPrice: number; amount: number; kind: string; minutes: number | null }[]
  subtotal: number
  discountPercent: number | null
  discountAmount: number
  tax1Name: string | null
  tax1Percent: number | null
  tax1Amount: number
  tax2Name: string | null
  tax2Percent: number | null
  tax2Amount: number
  paidAmount: number
  payments: { id: number; paidOn: IsoDate; amount: number; method: PaymentMethod; reference: string; simulated: boolean }[]
  canPay: boolean
}

export interface UnbilledProject extends Named {
  code: string
  minutes: number
  timeAmount: number
  expenseAmount: number
  entries: number
  /** Entries left out because no rate applies. */
  withoutRate: number
}

export interface UnbilledClient extends Named {
  currency: string
  total: number
  projects: UnbilledProject[]
}

export interface NewInvoiceInput {
  clientId: number
  projectIds: number[]
  from: IsoDate | null
  to: IsoDate | null
  grouping: 'task' | 'person' | 'project' | 'detailed'
  withExpenses: boolean
  subject: string
}

export interface ReportRow extends Named {
  /** Such as the client of a project. */
  sub?: string
  currency?: string
  minutes: number
  billableMinutes: number
  /** Null where it may not be seen, or is in several currencies. */
  amount: number | null
}

export interface TimeReport {
  from: IsoDate
  to: IsoDate
  /** Whether it has everyone's time that the actor may see, or only their own. */
  scope: 'own' | 'team'
  minutes: number
  billableMinutes: number
  amounts: { currency: string; amount: number }[]
  byClient: ReportRow[]
  byProject: ReportRow[]
  byTask: ReportRow[]
  byPerson: ReportRow[]
  byDay: WeekPoint[]
}

export interface HomeInfo {
  today: IsoDate
  week: { day: IsoDate; billable: number; other: number }[]
  capacityMinutes: number
  running: TimeEntry | null
  now: string
  recent: TimeEntry[]
  projects: ProjectRow[]
  /** For those who handle invoices. */
  money?: {
    outstanding: { currency: string; amount: number }[]
    late: { currency: string; amount: number; count: number }[]
    drafts: number
    unbilled: { currency: string; amount: number }[]
    /** Invoiced and paid in each of the last months, in company currency only. */
    currency: string
    months: { month: string; invoiced: number; paid: number }[]
  }
  /** For those who see others' time. */
  team?: (Named & { photoId: number | null; minutes: number; capacityMinutes: number })[]
}

export interface TeamMember extends Named {
  photoId: number | null
  role: string
  kind: 'employee' | 'contractor'
  minutes: number
  billableMinutes: number
  capacityMinutes: number
}

export interface TeamWeek {
  from: IsoDate
  to: IsoDate
  today: IsoDate
  members: TeamMember[]
}

export interface TaskRow extends Named {
  billable: boolean
  /** Added to new projects. */
  common: boolean
  archived: boolean
  projects: number
}
