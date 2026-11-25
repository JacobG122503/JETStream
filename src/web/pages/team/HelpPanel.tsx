import { useState } from 'react'
import type { HelpRequest } from '../../../shared/api'
import { usePerson } from '../../auth/authContext'
import { formatInstant } from '../../auth/timeZones'
import type { Load } from '../../auth/useLoad'
import { Button, ErrorState, LoadingState, Table, type TableColumn } from '../../ui'
import { InviteDialog, type Invitee } from './InvitesPanel'
import { LinkDialog, type ShownLink } from './LinkDialog'
import { ResetLink, type ResetTarget } from './ResetLink'

export function HelpPanel({ load }: { load: Load<{ requests: HelpRequest[] }> }) {
  const { status, data, error, reload } = load
  const { timeZone } = usePerson()
  const [target, setTarget] = useState<ResetTarget | null>(null)
  const [invitee, setInvitee] = useState<Invitee | null>(null)
  const [link, setLink] = useState<ShownLink | null>(null)

  const columns: TableColumn<HelpRequest>[] = [
    { id: 'name', header: 'Name', cell: ({ name }) => name, sortValue: ({ name }) => name },
    { id: 'email', header: 'Email', cell: ({ email }) => email, sortValue: ({ email }) => email },
    { id: 'requestedAt', header: 'Asked', cell: (row) => formatInstant(row.requestedAt, timeZone), sortValue: (row) => row.requestedAt },
  ]

  return (
    <div className="panel">
      <p>People who forgot their password. Anyone can ask in someone else&apos;s name, so make sure who it is.</p>
      {status === 'loading' ? (
        <LoadingState look="skeleton" label="Loading help requests" />
      ) : !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <Table
          caption="Help requests"
          hideCaption
          columns={columns}
          rows={data.requests}
          rowKey={({ id }) => String(id)}
          rowLabel={({ name }) => name}
          empty={{ icon: 'inbox', title: 'No help requests', description: 'Nobody needs help with signing in.' }}
          rowActions={(row) =>
            row.hasPassword ? (
              <Button size="small" onClick={() => setTarget({ id: row.personId, name: row.name })} aria-label={`Make a reset link for ${row.name}`}>
                Make reset link
              </Button>
            ) : (
              <Button size="small" onClick={() => setInvitee({ name: row.name, email: row.email })} aria-label={`Invite ${row.name}`}>
                Invite
              </Button>
            )
          }
        />
      )}
      <ResetLink target={target} onClose={() => setTarget(null)} onMade={reload} />
      {invitee && (
        <InviteDialog
          invitee={invitee}
          onClose={() => setInvitee(null)}
          onInvited={(made) => {
            setInvitee(null)
            setLink(made)
            reload()
          }}
        />
      )}
      <LinkDialog link={link} onClose={() => setLink(null)} />
    </div>
  )
}
