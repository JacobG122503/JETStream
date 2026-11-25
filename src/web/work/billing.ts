import type { PaymentTerms } from '../../shared/work'
import type { FieldSpec } from './FormDialog'

export const currencies = ['USD', 'EUR', 'CAD', 'GBP', 'MXN', 'AUD', 'CHF', 'JPY']

export const termLabels: Record<PaymentTerms, string> = {
  upon_receipt: 'Upon receipt', net_15: 'Net 15', net_30: 'Net 30', net_45: 'Net 45', net_60: 'Net 60', custom: 'Custom',
}

export const termOptions = Object.entries(termLabels).map(([value, label]) => ({ value, label }))

export const taxFields: FieldSpec[] = [
  { name: 'tax1Name', label: 'Tax', type: 'text', half: true },
  { name: 'tax1Percent', label: 'Tax, percent', type: 'percent', half: true },
  { name: 'tax2Name', label: 'Second tax', type: 'text', half: true },
  { name: 'tax2Percent', label: 'Second tax, percent', type: 'percent', half: true },
]

export const termFields: FieldSpec[] = [
  { name: 'paymentTerms', label: 'Payment terms', type: 'select', options: termOptions, half: true },
  { name: 'paymentTermDays', label: 'Days until due', type: 'whole', required: true, show: ({ paymentTerms }) => paymentTerms === 'custom', half: true },
]

export const methodLabels = {
  check: 'Check', bank_transfer: 'Bank transfer', card: 'Card', cash: 'Cash', online: 'Online', retainer: 'From retainer', other: 'Other',
} as const
