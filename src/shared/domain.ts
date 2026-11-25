/** The fixed vocabularies of the data model. The database checks the same values. */

export const personStatuses = ['pending', 'active', 'archived'] as const
export const personKinds = ['employee', 'contractor'] as const
export const rateKinds = ['billable', 'cost'] as const

export const builtInRoleKeys = ['administrator', 'manager', 'member', 'people_admin', 'accounting', 'executive'] as const

export const projectTypes = ['time_materials', 'fixed_fee', 'non_billable'] as const
export const rateMethods = ['project', 'task', 'person', 'none'] as const
export const budgetTypes = [
  'none', 'total_hours', 'total_fees', 'hours_per_task', 'fees_per_task', 'hours_per_person',
] as const
export type ProjectType = (typeof projectTypes)[number]
export type RateMethod = (typeof rateMethods)[number]
export type BudgetType = (typeof budgetTypes)[number]

/** Status of a single time entry or expense. */
export const entryStatuses = ['unsubmitted', 'submitted', 'approved', 'rejected'] as const
export type EntryStatus = (typeof entryStatuses)[number]
export const submissionStatuses = ['submitted', 'approved', 'rejected', 'withdrawn'] as const
export const approvalActions = ['submitted', 'withdrawn', 'approved', 'rejected', 'unlocked'] as const

export const reimbursementStatuses = ['none', 'pending', 'approved', 'paid'] as const

export const paymentTerms = ['upon_receipt', 'net_15', 'net_30', 'net_45', 'net_60', 'custom'] as const
/** "Late" is an open invoice past its due date, so it is not stored. */
export const invoiceStatuses = ['draft', 'open', 'paid', 'closed'] as const
export type InvoiceStatus = (typeof invoiceStatuses)[number]
export const lineKinds = ['time', 'expense', 'manual', 'retainer'] as const
export const messageKinds = ['sent', 'reminder', 'thank_you', 'note'] as const
export const documentKinds = ['invoice', 'estimate'] as const
export type DocumentKind = (typeof documentKinds)[number]

export const paymentMethods = ['check', 'bank_transfer', 'card', 'cash', 'online', 'retainer', 'other'] as const
export type PaymentMethod = (typeof paymentMethods)[number]
export const reminderStatuses = ['scheduled', 'sent', 'skipped'] as const
export const recurringFrequencies = ['weekly', 'monthly', 'quarterly', 'yearly'] as const
export const recurringStatuses = ['active', 'paused', 'ended'] as const
export const retainerStatuses = ['active', 'closed'] as const
export const retainerEntryKinds = ['top_up', 'draw_down', 'refund', 'adjustment'] as const

export const estimateStatuses = ['draft', 'sent', 'accepted', 'declined'] as const
export const estimateAnswers = ['accepted', 'declined'] as const

export const roundingModes = ['off', 'up', 'nearest', 'down'] as const
export const roundingIncrements = [5, 6, 10, 15, 30] as const
export type RoundingMode = (typeof roundingModes)[number]
export type RoundingIncrement = (typeof roundingIncrements)[number]

export const reportVisibilities = ['private', 'shared'] as const
export const scheduleFrequencies = ['daily', 'weekly', 'monthly'] as const

export const outboxStatuses = ['captured', 'queued', 'sent', 'failed'] as const
export const jobStatuses = ['running', 'succeeded', 'failed'] as const

export const timeOffKinds = ['vacation', 'sick', 'unpaid', 'other'] as const
export const accrualMethods = ['none', 'yearly', 'monthly'] as const
export const timeOffStatuses = ['pending', 'approved', 'declined', 'cancelled'] as const
export const timeOffEntryKinds = ['accrual', 'used', 'adjustment', 'carry_over'] as const

export const assignmentRepeats = ['none', 'weekly', 'every_two_weeks', 'monthly'] as const

export const importStatuses = ['previewed', 'completed', 'failed', 'undone'] as const
export const deliveryStatuses = ['pending', 'succeeded', 'failed'] as const

export const timeModes = ['duration', 'start_end'] as const
export const timeFormats = ['12h', '24h'] as const
export const dateFormats = ['mdy', 'dmy', 'ymd'] as const
export const numberFormats = ['1,234.56', '1.234,56', '1 234,56'] as const
export const currencyPlacements = ['symbol_before', 'symbol_after', 'code_before', 'code_after'] as const
export const hourFormats = ['decimal', 'hours_minutes'] as const
