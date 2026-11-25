import { passwordLength } from '../../shared/accounts'
import { PasswordField, type PasswordFieldProps } from '../ui'

const passwordRule = `${passwordLength.min} to ${passwordLength.max} characters. Spaces are fine; your email address and common passwords are not.`

/** For choosing a password: shows the rule beforehand. The server decides. */
export function NewPasswordField(props: Omit<PasswordFieldProps, 'hint' | 'autoComplete'>) {
  return <PasswordField {...props} hint={passwordRule} autoComplete="new-password" required />
}
