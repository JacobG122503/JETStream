/** Integers between JavaScript and bigint or numeric columns, without ever losing digits. */

export function toDatabaseInteger(value: number): string {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Cannot store ${value}: not an exact whole number.`)
  return String(value)
}

/** Reads a bigint, or a sum of integers, which the drivers return as string, number or bigint. */
export function fromDatabaseInteger(value: string | number | bigint): number {
  if (typeof value === 'string' && !/^-?\d+$/.test(value)) throw new RangeError(`Not a whole number: ${value}`)
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new RangeError(`The database value ${value} is too large to be read exactly.`)
  return result
}
