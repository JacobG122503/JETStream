/** The three accounts anyone may use in a demo. */
export const demoAccounts = [
  { key: 'admin', email: 'admin@jet.demo', label: 'Administrator' },
  { key: 'lead', email: 'lead@jet.demo', label: 'Project lead' },
  { key: 'employee', email: 'employee@jet.demo', label: 'Employee' },
] as const
export const demoPassword = 'jetdemo123'

/** The accounts as shown to whoever runs the demo. */
export function demoAccountLines(): string[] {
  return [
    ...demoAccounts.map(({ email, label }) => `  ${email.padEnd(18)} ${label}`),
    `  Password for all: ${demoPassword}`,
  ]
}
