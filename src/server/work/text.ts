/** How messages to people write amounts and dates. */
import { currencyExponent } from '../../shared/currency'
import { type IsoDate, partsOf } from '../../shared/dates'

export function formatMoney(amount: number, currency: string): string {
  const exponent = currencyExponent(currency)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(amount / 10 ** exponent)
}

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function formatDate(date: IsoDate): string {
  const { year, month, day } = partsOf(date)
  return `${months[month - 1]} ${day}, ${year}`
}

export const formatHours = (minutes: number): string => (minutes / 60).toFixed(2)
