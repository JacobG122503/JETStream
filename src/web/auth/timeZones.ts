import type { ComboboxOption } from '../ui'

/** Every time zone the browser knows, by its usual name, and the given ones. */
export function timeZoneOptions(...more: string[]): ComboboxOption[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return [...new Set([...known, 'UTC', ...more])]
    .sort()
    .map((value) => ({ value, label: value.replaceAll('_', ' ') }))
}

export function formatInstant(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso))
}
