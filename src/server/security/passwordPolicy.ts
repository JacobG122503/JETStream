import { passwordLength } from '../../shared/accounts'
import { commonPasswords } from './commonPasswords'

/** Why a new password is refused, or null. Every place that sets a password asks here. */
export function passwordProblem(password: string, email: string): string | null {
  const text = password.normalize('NFKC')
  const characters = [...text]
  const { min, max } = passwordLength
  if (characters.length < min) return `The password needs at least ${min} characters.`
  if (characters.length > max) return `The password can have at most ${max} characters.`
  const folded = text.toLowerCase()
  if (new Set([...folded]).size === 1) return 'The password must not be one character repeated.'
  const address = email.trim().normalize('NFKC').toLowerCase()
  if (folded === address || folded === address.split('@')[0]) return 'The password must not be your email address.'
  if (commonPasswords.has(folded)) return 'This password is too common. Choose one that is harder to guess.'
  return null
}
