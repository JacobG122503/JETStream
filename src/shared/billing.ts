/** What the server's API sends about invoices, estimates, recurring invoices and retainers. */
import type { IsoDate } from './dates'
import type { InvoiceStatus, PaymentMethod } from './domain'
import type { InvoiceRow, Named, PaymentTerms } from './work'

export interface LineInput {
  /** Of the line it changes; null for a new one. */
  id: number | null
  description: string
  /** Thousandths; may be below 0. */
  quantity: number
  /** Minor units; may be below 0. */
  unitPrice: number
  projectId: number | null
  categoryId: number | null
  tax1: boolean
  tax2: boolean
}

export interface DocumentTerms {
  subject: string
  purchaseOrder: string
  notes: string
  discountPercent: number | null
  tax1Name: string | null
  tax1Percent: number | null
  tax2Name: string | null
  tax2Percent: number | null
}

export interface InvoiceInput extends DocumentTerms {
  clientId: number
  /** Empty for the next one. */
  number: string
  issuedOn: IsoDate
  paymentTerms: PaymentTerms
  /** Used for custom terms. */
  dueOn: IsoDate
  lines: LineInput[]
}

export interface EstimateInput extends DocumentTerms {
  clientId: number
  number: string
  issuedOn: IsoDate
  expiresOn: IsoDate | null
  lines: LineInput[]
}

export interface DocumentLineRow extends Omit<LineInput, 'id'> {
  id: number
  kind: string
  minutes: number | null
  amount: number
}

/** What is printed, and what the client sees. */
export interface PrintedDocument extends DocumentTerms {
  number: string
  currency: string
  company: { name: string; address: string; logo: boolean }
  clientName: string
  clientAddress: string
  issuedOn: IsoDate
  lines: DocumentLineRow[]
  subtotal: number
  discountAmount: number
  tax1Amount: number
  tax2Amount: number
  total: number
}

export interface Recipient {
  name: string
  email: string
}

export interface MessageRow {
  id: number
  kind: string
  at: string
  sender: string | null
  recipients: Recipient[]
  subject: string
  body: string
}

export interface LinkRow {
  id: number
  createdAt: string
  lastViewedAt: string | null
}

export interface PaymentRow {
  id: number
  paidOn: IsoDate
  amount: number
  method: PaymentMethod
  reference: string
  notes: string
  simulated: boolean
  refunds: { id: number; amount: number; refundedOn: IsoDate; reason: string }[]
}

export interface InvoiceDetails extends InvoiceRow, PrintedDocument {
  version: number
  paymentTerms: PaymentTerms
  paidAmount: number
  payments: PaymentRow[]
  writeOff: { amount: number; on: IsoDate; reason: string } | null
  messages: MessageRow[]
  /** Those that still work. */
  links: LinkRow[]
  attachments: { id: number; name: string }[]
  /** Receipts of its expenses that are not attached. */
  receipts: number
  recurring: boolean
  /** Of the client, with money left, in the same currency. */
  retainers: (Named & { balance: number })[]
  contacts: Recipient[]
  canPay: boolean
  canManagePayments: boolean
}

export interface DocumentClient extends Named {
  currency: string
  tax1Name: string | null
  tax1Percent: number | null
  tax2Name: string | null
  tax2Percent: number | null
  discountPercent: number | null
  paymentTerms: PaymentTerms
  paymentTermDays: number | null
  projects: (Named & { code: string })[]
}

/** What a new document can be made of. */
export interface DocumentOptions {
  today: IsoDate
  clients: DocumentClient[]
  categories: Named[]
  invoiceNotes: string
  estimateNotes: string
  estimateValidDays: number
}

export interface MessageInput {
  kind: 'sent' | 'reminder' | 'thank_you' | 'note'
  recipients: Recipient[]
  subject: string
  body: string
}

/** What a client sees of an invoice through a link. */
export interface ClientInvoice extends PrintedDocument {
  status: Exclude<InvoiceStatus, 'draft'>
  dueOn: IsoDate
  late: boolean
  paidAmount: number
  dueAmount: number
  attachments: { id: number; name: string }[]
}

export interface EstimateRow extends Named {
  number: string
  client: Named
  subject: string
  status: 'draft' | 'sent' | 'accepted' | 'declined'
  expired: boolean
  issuedOn: IsoDate
  expiresOn: IsoDate | null
  currency: string
  total: number
}

export interface EstimateDetails extends EstimateRow, PrintedDocument {
  version: number
  messages: MessageRow[]
  links: LinkRow[]
  answers: { id: number; answer: 'accepted' | 'declined'; name: string; comment: string; at: string; byClient: boolean }[]
  contacts: Recipient[]
  invoice: { id: number; number: string } | null
  project: Named | null
  canInvoice: boolean
  canCreateProject: boolean
}

export interface ClientEstimate extends PrintedDocument {
  status: 'sent' | 'accepted' | 'declined'
  expired: boolean
  expiresOn: IsoDate | null
  answer: { answer: 'accepted' | 'declined'; name: string; comment: string } | null
}

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface RecurringInput extends DocumentTerms {
  clientId: number
  paymentTerms: PaymentTerms
  paymentTermDays: number | null
  frequency: Frequency
  interval: number
  startsOn: IsoDate
  endsOn: IsoDate | null
  sendAutomatically: boolean
  lines: LineInput[]
}

export interface RecurringRow {
  id: number
  client: Named
  subject: string
  currency: string
  total: number
  frequency: Frequency
  interval: number
  nextOn: IsoDate | null
  endsOn: IsoDate | null
  status: 'active' | 'paused' | 'ended'
  sendAutomatically: boolean
  made: number
}

export interface RecurringDetails extends RecurringRow, DocumentTerms {
  version: number
  paymentTerms: PaymentTerms
  paymentTermDays: number | null
  startsOn: IsoDate
  lines: DocumentLineRow[]
  invoices: InvoiceRow[]
}

export interface RetainerRow extends Named {
  version: number
  client: Named
  project: Named | null
  currency: string
  status: 'active' | 'closed'
  balance: number
}

export interface RetainerDetails extends RetainerRow {
  entries: { id: number; kind: string; amount: number; on: IsoDate; notes: string; invoice: { id: number; number: string } | null }[]
  /** Open invoices it can pay. */
  openInvoices: { id: number; number: string; dueAmount: number }[]
}

/** What a client owes. */
export interface Statement {
  client: Named & { address: string; currency: string }
  company: { name: string; address: string; logo: boolean }
  today: IsoDate
  invoices: InvoiceRow[]
  payments: { invoice: string; paidOn: IsoDate; amount: number; method: PaymentMethod }[]
  /** Due amounts by how late they are: not yet, up to 30, 60, 90 days, and later. */
  ageing: number[]
  retainers: (Named & { balance: number })[]
}
