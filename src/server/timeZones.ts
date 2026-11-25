const known = new Set(Intl.supportedValuesOf('timeZone'))

/** Whether it is an IANA time zone this server knows, under its current name or an older one. */
export function isTimeZone(name: string): boolean {
  if (known.has(name) || name === 'UTC') return true
  // Browsers with newer or older data use other names for the same zone, such as Asia/Kolkata.
  if (!/^[A-Z][A-Za-z_]+(\/[A-Z][A-Za-z0-9_+-]*){1,2}$/.test(name)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}
