import { demoAccounts, demoPassword } from './company'

/** The accounts as shown to whoever runs the demo. */
export function demoAccountLines(): string[] {
  return [
    ...demoAccounts.map(({ email, label }) => `  ${email.padEnd(18)} ${label}`),
    `  Password for all: ${demoPassword}`,
  ]
}
