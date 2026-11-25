import type { MessageRow } from '../../shared/billing'
import { usePerson } from '../auth/authContext'
import { formatInstant } from '../auth/timeZones'
import { Card } from '../ui'

const labels: Record<string, string> = { sent: 'Sent', reminder: 'Reminder', thank_you: 'Thank you', note: 'Note' }

export function MessageHistory({ messages }: { messages: MessageRow[] }) {
  const { timeZone } = usePerson()
  if (messages.length === 0) return null
  return (
    <Card title="History">
      <ul className="payments">
        {messages.map(({ id, kind, at, sender, recipients, subject, body }) => (
          <li key={id}>
            <span className="cell-two">
              <span>
                <span className="strong">{labels[kind] ?? kind}</span> <span className="muted">{[sender, recipients.length > 0 && `to ${recipients.map(({ email }) => email).join(', ')}`].filter(Boolean).join(' ')}</span>
              </span>
              <span className="cell-sub lines">{kind === 'note' ? body : subject}</span>
            </span>
            <span className="muted">{formatInstant(at, timeZone)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
