import { currencyExponent } from '../../shared/currency'
import { monthNames, partsOf, weekdayNames, weekdayOf } from '../ui/dates'

const money = new Map<string, Intl.NumberFormat>()

/** Minor units of a currency, as people read them. */
export function formatMoney(amount: number, currency: string, { whole = false } = {}): string {
  const exponent = currencyExponent(currency)
  const key = `${currency}/${whole}`
  let format = money.get(key)
  if (!format) {
    const digits = whole ? 0 : exponent
    format = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits })
    money.set(key, format)
  }
  return format.format(amount / 10 ** exponent)
}

/** Several currencies in one line. */
export const formatAmounts = (amounts: readonly { currency: string; amount: number }[], options?: { whole?: boolean }): string =>
  amounts.length === 0 ? formatMoney(0, 'USD', options) : amounts.map(({ currency, amount }) => formatMoney(amount, currency, options)).join(' + ')

const hours = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Decimal hours: 375 minutes are 6.25. */
export const formatHours = (minutes: number): string => hours.format(minutes / 60)

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
