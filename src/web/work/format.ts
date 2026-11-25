import { currencyExponent } from '../../shared/currency'
import type { Formats } from '../../shared/work'
import { monthNames, partsOf, setDateFormat, weekdayNames, weekdayOf } from '../ui/dates'

let formats: Formats = {
  currency: 'USD', weekStartsOn: 1, dateFormat: 'mdy', numberFormat: '1,234.56', currencyPlacement: 'symbol_before', hourFormat: 'decimal', timeMode: 'duration',
  modules: { expenses: true, invoices: true, estimates: true, timeOff: true, scheduling: true, approval: true },
}

/** Takes over how the company wants figures shown. */
export function setFormats(next: Formats) {
  formats = next
  setDateFormat(next.dateFormat)
}

export const getFormats = (): Formats => formats

/** A number in the company's way of writing. */
function formatNumber(value: number, digits: number): string {
  const text = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  if (formats.numberFormat === '1,234.56') return text
  const group = formats.numberFormat === '1.234,56' ? '.' : ' '
  return text.replace(/[,.]/g, (mark) => (mark === ',' ? group : ','))
}

const symbols = new Map<string, string>()
function symbolOf(currency: string): string {
  let symbol = symbols.get(currency)
  if (symbol === undefined) {
    symbol = new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(0).find(({ type }) => type === 'currency')?.value ?? currency
    symbols.set(currency, symbol)
  }
  return symbol
}

/** Minor units of a currency, as people read them. */
export function formatMoney(amount: number, currency: string, { whole = false } = {}): string {
  const exponent = currencyExponent(currency)
  const number = formatNumber(Math.abs(amount) / 10 ** exponent, whole ? 0 : exponent)
  const sign = amount < 0 ? '-' : ''
  switch (formats.currencyPlacement) {
    case 'symbol_before':
      return `${sign}${symbolOf(currency)}${number}`
    case 'symbol_after':
      return `${sign}${number} ${symbolOf(currency)}`
    case 'code_before':
      return `${sign}${currency} ${number}`
    case 'code_after':
      return `${sign}${number} ${currency}`
  }
}

/** Minor units as they are typed into a field. */
export const moneyInput = (amount: number, currency: string): string => {
  const exponent = currencyExponent(currency)
  return (amount / 10 ** exponent).toFixed(exponent)
}

/** Several currencies in one line. */
export const formatAmounts = (amounts: readonly { currency: string; amount: number }[], options?: { whole?: boolean }): string =>
  amounts.length === 0 ? formatMoney(0, formats.currency, options) : amounts.map(({ currency, amount }) => formatMoney(amount, currency, options)).join(' + ')

/** 375 minutes are 6.25, or 6:15 where the company wants that. */
export const formatHours = (minutes: number): string =>
  formats.hourFormat === 'decimal' ? formatNumber(minutes / 60, 2) : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`

/** Hours as they are typed into a field. */
export const hoursInput = (minutes: number): string => (minutes / 60).toFixed(2)

const shortMonth = (month: number) => monthNames[month - 1]?.slice(0, 3)

/** "Wednesday, 25 Nov" */
export function formatDay(date: string): string {
  const { month, day } = partsOf(date)
  return `${weekdayNames[weekdayOf(date)]}, ${day} ${shortMonth(month)}`
}

/** "21 to 27 Nov 2026" */
export function formatWeek(from: string, to: string): string {
  const [first, last] = [partsOf(from), partsOf(to)]
  return `${first.day}${first.month === last.month ? '' : ` ${shortMonth(first.month)}`} to ${last.day} ${shortMonth(last.month)} ${last.year}`
}

/** 90 is 1.5 h, for axes and sums where minutes do not matter. */
export const formatDecimalHours = (minutes: number): string => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(minutes / 60)} h`

/** Seconds of a running timer as 1:02:09. */
export function formatClock(seconds: number): string {
  const rest = Math.max(0, Math.floor(seconds))
  const two = (value: number) => String(value).padStart(2, '0')
  return `${Math.floor(rest / 3600)}:${two(Math.floor(rest / 60) % 60)}:${two(rest % 60)}`
}

/** "1:30", "1.5", "1,5", "90m", "1h 30m" as minutes; null for anything else. */
export function parseHours(text: string): number | null {
  const clean = text.trim().toLowerCase().replace(',', '.')
  if (clean === '') return null
  const colon = /^(\d{0,2}):([0-5]?\d)$/.exec(clean)
  if (colon) return Number(colon[1] || 0) * 60 + Number(colon[2])
  const words = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(clean)
  if (words && (words[1] !== undefined || words[2] !== undefined)) return Math.round(Number(words[1] ?? 0) * 60) + Number(words[2] ?? 0)
  if (!/^\d*\.?\d+$/.test(clean)) return null
  return Math.round(Number(clean) * 60)
}

/** "1,284.50" as minor units; null for anything that is not an amount of the currency. */
export function parseMoney(text: string, currency: string): number | null {
  const clean = text.replace(/[\s$€£,]/g, '')
  const exponent = currencyExponent(currency)
  const match = /^(\d{1,10})(?:\.(\d*))?$/.exec(clean)
  if (!match || (match[2] ?? '').length > exponent) return null
  return Number(match[1]) * 10 ** exponent + Number((match[2] ?? '').padEnd(exponent, '0') || 0)
}

export const percentOf = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 100))

/** Minutes after midnight, as people write the time of day. */
export const showClock = (minute: number): string => {
  const hour = Math.floor(minute / 60)
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, '0')} ${hour % 24 < 12 ? 'am' : 'pm'}`
}

/** "8:30 am", "16:15" or "4pm" as minutes after midnight; null for anything else. */
export function parseClock(text: string): number | null {
  const match = /^(\d{1,2})(?::?([0-5]\d))?\s*([ap])?\.?m?\.?$/i.exec(text.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2] ?? 0)
  const half = match[3]?.toLowerCase()
  if (half) return hour >= 1 && hour <= 12 ? ((hour % 12) + (half === 'p' ? 12 : 0)) * 60 + minute : null
  return hour <= 24 && hour * 60 + minute <= 1440 ? hour * 60 + minute : null
}
