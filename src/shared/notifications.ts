/** What people are told about. `email`: whether also by email, unless they chose otherwise. */
export const notificationKinds = {
  approval: { label: 'Weeks waiting for my approval', email: true },
  approved: { label: 'My week was approved', email: false },
  rejected: { label: 'My week was sent back', email: true },
  timesheet_reminder: { label: 'Reminders to submit my week', email: true },
  budget: { label: 'Budget alerts', email: true },
  assignment: { label: 'I was planned on a project', email: false },
  invoice_late: { label: 'Invoices that are late', email: true },
  invoice_paid: { label: 'Invoices that were paid', email: false },
  recurring: { label: 'Recurring invoices that were made', email: false },
  estimate_answer: { label: 'Answers to estimates', email: true },
  time_off: { label: 'Time-off requests to decide', email: true },
  time_off_decision: { label: 'Decisions on my time off', email: true },
  sign_up: { label: 'People who ask to join', email: true },
} as const

export type NotificationKind = keyof typeof notificationKinds

export interface NotificationRow {
  id: number
  kind: string
  title: string
  body: string
  path: string | null
  read: boolean
  at: string
}

export interface NotificationList {
  unread: number
  rows: NotificationRow[]
}

export interface NotificationPreference {
  kind: NotificationKind
  inApp: boolean
  email: boolean
}
