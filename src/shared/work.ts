/** What the server's API sends about time, projects, clients, expenses, invoices and reports. */
import type { IsoDate } from './dates'
import type {
  BudgetType, currencyPlacements, dateFormats, EntryStatus, hourFormats, InvoiceStatus, numberFormats, paymentTerms, ProjectType,
  RateMethod, RoundingIncrement, RoundingMode, timeFormats, timeModes,
} from './domain'
import type { Weekday } from './dates'

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
  /** Minutes after midnight, where time is entered as start and end. */
  startMinute: number | null
  endMinute: number | null
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
  /** Whose week it is. */
  person: Named
  own: boolean
  /** Whose weeks may be looked at; empty for those who see only their own. */
  people: Named[]
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
  startMinute: number | null
  endMinute: number | null
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
  pinned: boolean
  tags: string[]
  members: (Named & { photoId: number | null; isManager: boolean })[]
}

export interface ProjectTaskRow extends Named {
  billable: boolean
  minutes: number
  budgetMinutes: number | null
  billableAmount?: number
  rate?: number | null
  budgetAmount?: number | null
  removed: boolean
}

export interface ProjectPersonRow extends Named {
  photoId: number | null
  isManager: boolean
  minutes: number
  budgetMinutes: number | null
  billableAmount?: number
  rate?: number | null
  removed: boolean
}

export interface WeekPoint {
  from: IsoDate
  billable: number
  other: number
}

export interface ProjectDetails extends ProjectRow {
  version: number
  notes: string
  tags: string[]
  pinned: boolean
  canEdit: boolean
  /** Whether rates, fees and fee budgets may be changed. */
  canEditMoney: boolean
  canManageFlags: boolean
  budgetMinutes: number | null
  budgetMonthly: boolean
  budgetIncludesExpenses: boolean
  budgetVisibleToAll: boolean
  budgetAlertPercent: number | null
  budgetAmount?: number | null
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
  /** To search by. */
  contactNames: string[]
  minutes: number
}

export interface Contact extends Named {
  version: number
  title: string
  email: string | null
  officePhone: string | null
  mobilePhone: string | null
}

export type PaymentTerms = (typeof paymentTerms)[number]

export interface ClientInput {
  name: string
  currency: string
  address: string
  notes: string
  tax1Name: string | null
  tax1Percent: number | null
  tax2Name: string | null
  tax2Percent: number | null
  discountPercent: number | null
  paymentTerms: PaymentTerms
  paymentTermDays: number | null
}

export interface ClientDetails extends ClientRow {
  version: number
  address: string
  notes: string
  contactList: Contact[]
  canManage: boolean
  /** Why the currency cannot be changed; null when it can. */
  currencyLocked: string | null
  /** Only for those who manage clients or handle invoices. */
  billing?: Omit<ClientInput, 'name' | 'currency' | 'address' | 'notes'>
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
  receipts: Receipt[]
}

export interface ExpenseOptions {
  notesRequired: boolean
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
  /** Whether the actor sees any amounts. */
  showAmounts: boolean
  amounts: { currency: string; amount: number }[]
  uninvoiced: { currency: string; amount: number }[]
  byClient: ReportRow[]
  byProject: ReportRow[]
  byTask: ReportRow[]
  byPerson: ReportRow[]
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
  version: number
  billable: boolean
  /** Only for those who see billable rates. */
  defaultRate?: number | null
  /** Added to new projects. */
  common: boolean
  archived: boolean
  projects: number
}

export interface CompanySettingsInput {
  name: string
  address: string
  currency: string
  timeZone: string
  weekStartsOn: number
  fiscalYearStartMonth: number
  dateFormat: (typeof dateFormats)[number]
  timeFormat: (typeof timeFormats)[number]
  numberFormat: (typeof numberFormats)[number]
  currencyPlacement: (typeof currencyPlacements)[number]
  hourFormat: (typeof hourFormats)[number]
  timeMode: (typeof timeModes)[number]
  roundingMode: RoundingMode
  roundingMinutes: RoundingIncrement
  timeNotesRequired: boolean
  expenseNotesRequired: boolean
  approvalEnabled: boolean
  lockAfterDays: number | null
  lockedThrough: IsoDate | null
  expensesEnabled: boolean
  invoicesEnabled: boolean
  estimatesEnabled: boolean
  timeOffEnabled: boolean
  schedulingEnabled: boolean
  tax1Name: string | null
  tax1Percent: number | null
  tax2Name: string | null
  tax2Percent: number | null
  paymentTerms: PaymentTerms
  paymentTermDays: number | null
  invoiceNotes: string
  estimateNotes: string
  estimateValidDays: number
  reminderDays: number[]
}

export interface CompanySettings extends CompanySettingsInput {
  version: number
  logoFileId: number | null
}

/** What the web app needs to show figures as the company wants them. */
export interface Formats {
  currency: string
  weekStartsOn: Weekday
  dateFormat: (typeof dateFormats)[number]
  numberFormat: (typeof numberFormats)[number]
  currencyPlacement: (typeof currencyPlacements)[number]
  hourFormat: (typeof hourFormats)[number]
  timeMode: (typeof timeModes)[number]
  modules: { expenses: boolean; invoices: boolean; estimates: boolean; timeOff: boolean; scheduling: boolean; approval: boolean }
}

export interface PersonInput {
  name: string
  email: string
  phone: string | null
  kind: 'employee' | 'contractor'
  weeklyCapacityMinutes: number
  startedOn: IsoDate | null
  notes: string | null
  labels: string[]
}

export interface PersonRate {
  id: number
  version: number
  kind: 'billable' | 'cost'
  startsOn: IsoDate
  rate: number
}

/** A person's working details, for those who manage people or see rates. */
export interface PersonWork extends PersonInput {
  version: number
  status: string
  canManage: boolean
  /** Why one may not archive or change the person; null when one may. */
  refusal: string | null
  knownLabels: string[]
  currency: string
  /** Only of the kinds one may see. */
  rates: PersonRate[]
  mayEditRates: { billable: boolean; cost: boolean }
}

export interface ActivityRow {
  id: number
  at: string
  /** Null for the system itself. */
  actor: string | null
  action: string
  type: string
  summary: string
}

export interface TimeOptions {
  projects: TimeProject[]
  favorites: { id: number; projectId: number; taskId: number; notes: string }[]
  notesRequired: boolean
}

export interface ApprovalWeek {
  submissionId: number
  person: Named & { photoId: number | null }
  from: IsoDate
  to: IsoDate
  submittedAt: string
  minutes: number
  billableMinutes: number
  capacityMinutes: number
  expenses: { currency: string; amount: number }[]
  entries: { id: number; spentOn: IsoDate; client: string; project: string; task: string; minutes: number; billable: boolean; notes: string; mine: boolean }[]
  expenseRows: { id: number; spentOn: IsoDate; project: string; category: string; amount: number; currency: string; notes: string; mine: boolean }[]
}

export interface Approvals {
  pending: ApprovalWeek[]
  /** Weeks nobody handed in, newest first. */
  missing: { person: Named & { photoId: number | null }; from: IsoDate; to: IsoDate; minutes: number; capacityMinutes: number }[]
  /** Approved lately, which can be opened again. */
  approved: { submissionId: number; person: Named; from: IsoDate; to: IsoDate; minutes: number; decidedBy: string | null }[]
  canUnlock: boolean
}

export interface ExpenseCategory extends Named {
  version: number
  unitName: string | null
  unitPrice: number | null
  archived: boolean
}

export interface TeamExpense extends Omit<ExpenseRow, 'locked'> {
  person: Named
  receipts: Receipt[]
}

export interface Receipt {
  id: number
  name: string
  mediaType: string
}

export interface DetailedTime {
  showAmounts: boolean
  scope: 'own' | 'team'
  rows: {
    id: number
    spentOn: IsoDate
    client: string
    project: string
    task: string
    person: string
    notes: string
    minutes: number
    billable: boolean
    /** Null where it may not be seen or no rate applies. */
    amount: number | null
    currency: string
    invoiced: boolean
    status: EntryStatus
  }[]
}

export interface ExpenseReport {
  rows: {
    id: number
    spentOn: IsoDate
    client: string
    project: string
    category: string
    person: string
    notes: string
    amount: number
    currency: string
    billable: boolean
    invoiced: boolean
    reimbursementStatus: string
  }[]
}

export interface PaymentReport {
  rows: { id: number; paidOn: IsoDate; invoice: { id: number; number: string }; client: string; method: string; reference: string; amount: number; refunded: number; currency: string; simulated: boolean }[]
}
