/** ISO 4217 currencies whose minor unit is not a hundredth. */
const exponents: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0,
  XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4,
}

export function isCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code)
}

/** How many decimals the currency has: USD 2, JPY 0. */
export function currencyExponent(code: string): number {
  if (!isCurrencyCode(code)) throw new RangeError(`Not an ISO 4217 currency code: ${code}`)
  return exponents[code] ?? 2
}
