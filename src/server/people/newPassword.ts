import { invalidInput } from '../api/input'
import { passwordProblem } from '../security/passwordPolicy'

/** Refuses a new password that breaks the rules, naming the field it came from. */
export function checkNewPassword(password: string, email: string, field = 'password'): void {
  const problem = passwordProblem(password, email)
  if (problem !== null) throw invalidInput({ [field]: problem })
}
