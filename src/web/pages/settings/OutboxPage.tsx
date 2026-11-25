import { useState } from 'react'
import type { OutboxRow } from '../../../shared/notifications'
import { useAuth, usePerson } from '../../auth/authContext'
import { formatInstant } from '../../auth/timeZones'
import { useLoad } from '../../auth/useLoad'
import { Badge, Button, Dialog, Notice, Table, type Tone } from '../../ui'
import { SettingsLayout } from './SettingsLayout'

const looks: Record<OutboxRow['status'], { label: string; tone: Tone }> = {
  captured: { label: 'Not sent', tone: 'warning' }, queued: { label: 'Waiting', tone: 'info' }, sent: { label: 'Sent', tone: 'success' }, failed: { label: 'Failed', tone: 'danger' },
}

/** A message that was only kept can be sent from the person's own mail program. */
const mailto = ({ recipients, subject, body }: OutboxRow) =>
  `mailto:${recipients.map(({ email }) => encodeURIComponent(email)).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

export function OutboxPage() {
  const { status, data, error, reload } = useLoad<{ messages: OutboxRow[] }>('outbox')
  const { info } = useAuth()
  const { timeZone } = usePerson()
  const [open, setOpen] = useState<OutboxRow | null>(null)
  return (
    <SettingsLayout title="Outbox" current="/settings/outbox">
      {info && !info.emailDelivers && <Notice tone="warning" title="No email service is set up">Messages are only kept here, and nothing is sent. Set SMTP_URL and EMAIL_FROM on the server to send them.</Notice>}
      <Table
        caption="Outbox"
        hideCaption
        status={status}
        error={error}
        onRetry={reload}
        rows={data?.messages ?? []}
        rowKey={({ id }) => String(id)}
        rowLabel={({ subject }) => subject}
        columns={[
          { id: 'subject', header: 'Message', cell: ({ subject, recipients }) => <span className="cell-two"><span className="strong">{subject}</span><span className="cell-sub">to {recipients.map(({ email }) => email).join(', ')}</span></span>, sortValue: ({ subject }) => subject },
          { id: 'status', header: 'Status', cell: ({ status: is }) => <Badge tone={looks[is].tone}>{looks[is].label}</Badge>, sortValue: ({ status: is }) => is },
          { id: 'at', header: 'When', nowrap: true, cell: ({ at }) => formatInstant(at, timeZone), sortValue: ({ at }) => at },
        ]}
        rowActions={(row) => (
          <Button size="small" aria-label={`Show ${row.subject}`} onClick={() => setOpen(row)}>
            Show
          </Button>
        )}
        empty={{ icon: 'send', title: 'No messages', description: 'Every email appears here.' }}
      />
      {open && (
        <Dialog
          open
          onClose={() => setOpen(null)}
          title={open.subject}
          footer={
            <>
              <Button onClick={() => setOpen(null)}>Close</Button>
              {open.status !== 'sent' && (
                <a className="btn btn-secondary btn-medium" href={mailto(open)}>
                  Open in my mail program
                </a>
              )}
            </>
          }
        >
          <div className="stack">
            <p className="muted">To {open.recipients.map(({ name, email }) => (name && name !== email ? `${name} (${email})` : email)).join(', ')}</p>
            {open.error && <Notice tone="danger">{open.error}</Notice>}
            <p className="lines">{open.body}</p>
          </div>
        </Dialog>
      )}
    </SettingsLayout>
  )
}
