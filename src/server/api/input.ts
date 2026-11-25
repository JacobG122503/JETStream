/** Reading what a client sent: each value is checked, and everything that is wrong is told at once. */
import { emailMaxLength, isEmail, nameLength, normalizeEmail, roleDescriptionLength, roleNameLength } from '../../shared/accounts'
import { isCurrencyCode } from '../../shared/currency'
import { isIsoDate } from '../../shared/dates'
import { type Grants, isPermissionKey, type PermissionKey, problemWith } from '../../shared/permissions'
import { ApiError } from '../errors'
import { isTimeZone } from '../timeZones'

class InputError extends Error {}

/** Turns an unknown value into what it must be, or throws an InputError with a message for people. */
export type Reader<T> = (value: unknown) => T

export function readInput<R extends Record<string, Reader<unknown>>>(
  body: unknown, readers: R,
): { [K in keyof R]: ReturnType<R[K]> } {
  const source = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const result: Record<string, unknown> = {}
  const fields: Record<string, string> = {}
  for (const [name, read] of Object.entries(readers)) {
    try {
      result[name] = read(Object.hasOwn(source, name) ? source[name] : undefined)
    } catch (error) {
      if (!(error instanceof InputError)) throw error
      fields[name] = error.message
    }
  }
  if (Object.keys(fields).length > 0) throw invalidInput(fields)
  return result as { [K in keyof R]: ReturnType<R[K]> }
}

export const invalidInput = (fields: Record<string, string>) =>
  new ApiError(400, 'invalid_input', Object.values(fields)[0] ?? 'Something is missing.', { fields })

const refuse = (message: string): never => {
  throw new InputError(message)
}

// eslint-disable-next-line no-control-regex -- control characters are what it is about
const controlCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

export const personName: Reader<string> = (value) => {
  const text = typeof value === 'string' ? value.trim() : ''
  if ([...text].length < nameLength.min) return refuse('Enter a name.')
  if ([...text].length > nameLength.max) return refuse(`The name can have at most ${nameLength.max} characters.`)
  if (controlCharacters.test(text)) return refuse('The name contains characters that are not allowed.')
  return text
}

export const newEmail: Reader<string> = (value) => {
  const email = typeof value === 'string' ? normalizeEmail(value) : ''
  if (email === '') return refuse('Enter an email address.')
  return isEmail(email) ? email : refuse('Enter an email address such as name@example.com.')
}

/** An email to look up: anything that could be one. */
export const knownEmail: Reader<string> = (value) => {
  const email = typeof value === 'string' ? normalizeEmail(value) : ''
  if (email === '') return refuse('Enter your email address.')
  if (email.length > emailMaxLength || controlCharacters.test(email)) return refuse('Enter an email address such as name@example.com.')
  return email
}

export const password: Reader<string> = (value) =>
  typeof value === 'string' && value !== '' ? value : refuse('Enter a password.')

export const timeZone: Reader<string> = (value) =>
  typeof value === 'string' && isTimeZone(value) ? value : refuse('Choose a time zone from the list.')

export const flag: Reader<boolean> = (value) => (typeof value === 'boolean' ? value : refuse('Choose yes or no.'))

export const optionalFlag: Reader<boolean> = (value) => (value === undefined ? false : flag(value))

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 2 ** 31

export const id: Reader<number> = (value) => (isId(value) ? value : refuse('Choose one from the list.'))

/** A list of ids, without duplicates. Left out means none. */
export const ids: Reader<number[]> = (value) => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 5000 || !value.every(isId)) return refuse('Choose from the list.')
  return [...new Set(value)]
}

export const version: Reader<number> = (value) => (isId(value) ? value : refuse('The version is missing.'))

export const shortText: Reader<string> = (value) =>
  typeof value === 'string' && value.length <= 500 ? value : refuse('Something is missing.')

export const oneOf =
  <T extends string>(...values: T[]): Reader<T> =>
  (value) =>
    values.find((candidate) => candidate === value) ?? refuse('Choose one from the list.')

/** Whatever was sent; the route decides. */
export const anything: Reader<unknown> = (value) => value

/** The id in a path. One that cannot be an id is not found. */
export function pathId(value: unknown): number {
  const number = typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : NaN
  if (!isId(number)) throw new ApiError(404, 'not_found', 'Not found')
  return number
}

export const optionalId: Reader<number | null> = (value) => (value === undefined || value === null ? null : id(value))

const oneLine = (value: unknown) => (typeof value === 'string' ? value.normalize('NFC').trim() : '')

export const roleName: Reader<string> = (value) => {
  const text = oneLine(value)
  if (text === '') return refuse('Enter a name.')
  if ([...text].length > roleNameLength) return refuse(`The name can have at most ${roleNameLength} characters.`)
  if (controlCharacters.test(text)) return refuse('The name contains characters that are not allowed.')
  return text
}

export const roleDescription: Reader<string> = (value) => {
  if (value === undefined) return ''
  if (typeof value !== 'string') return refuse('Enter a description.')
  const text = oneLine(value)
  if ([...text].length > roleDescriptionLength) return refuse(`The description can have at most ${roleDescriptionLength} characters.`)
  if (controlCharacters.test(text)) return refuse('The description contains characters that are not allowed.')
  return text
}

/** Permissions with their level, complete with what they need. */
export const grants: Reader<Grants> = (value) => {
  const problem = problemWith(value)
  return problem === null ? (value as Grants) : refuse(problem)
}

/** Permissions switched on for a manager. Left out means none. */
export const extras: Reader<PermissionKey[]> = (value) => {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(isPermissionKey) || new Set(value).size < value.length) return refuse('Choose extras from the list.')
  return value
}

// Work -----------------------------------------------------------------------------------------------

export const optional =
  <T>(read: Reader<T>): Reader<T | null> =>
  (value) => (value === undefined || value === null || value === '' ? null : read(value))

export const date: Reader<string> = (value) => (typeof value === 'string' && isIsoDate(value) ? value : refuse('Enter a date.'))

/** Minutes of one day. */
export const dayMinutes: Reader<number> = (value) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1440 ? value : refuse('Enter a time of up to 24 hours.')

const mostMoney = 1_000_000_000_000
/** Minor units. */
export const money: Reader<number> = (value) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= mostMoney ? value : refuse('Enter an amount.')

export const positive: Reader<number> = (value) => {
  const number = money(value)
  return number > 0 ? number : refuse('Enter more than 0.')
}

/** Free text over any number of lines. */
export const text =
  (most: number): Reader<string> =>
  (value) => {
    if (value === undefined) return ''
    if (typeof value !== 'string') return refuse('Enter a text.')
    const trimmed = value.normalize('NFC').trim()
    return [...trimmed].length > most ? refuse(`Enter at most ${most} characters.`) : trimmed
  }

export const thingName: Reader<string> = (value) => {
  const name = oneLine(value)
  if (name === '') return refuse('Enter a name.')
  if ([...name].length > 120) return refuse('The name can have at most 120 characters.')
  return controlCharacters.test(name) ? refuse('The name contains characters that are not allowed.') : name
}

export const currency: Reader<string> = (value) =>
  typeof value === 'string' && isCurrencyCode(value) ? value : refuse('Choose a currency.')
