import { type FormEvent, useId, useState } from 'react'
import type { InviteRow, InviteStatus, NewLink } from '../../../shared/api'
import { ApiError, callApi, errorMessage } from '../../api'
import { usePerson } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { formatInstant } from '../../auth/timeZones'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Badge, Button, ConfirmDialog, Dialog, Table, type TableColumn, TextField, type Tone, useToast } from '../../ui'
import { accessBody, useAccess } from './access'
import { AccessFields } from './AccessFields'
import { LinkDialog, type ShownLink } from './LinkDialog'

const statuses: Record<InviteStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'info' },
  expired: { label: 'Expired', tone: 'warning' },
  void: { label: 'Void: the sender is no longer an administrator', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  revoked: { label: 'Revoked', tone: 'neutral' },
}

export interface Invitee {
  name: string
  email: string
}

export function InvitesPanel() {
  const { status, data, error, reload, setData } = useLoad<{ invites: InviteRow[] }>('invites')
  const { timeZone } = usePerson()
  const toast = useToast()
  const [inviting, setInviting] = useState(false)
  const [revoking, setRevoking] = useState<InviteRow | null>(null)
  const [renewing, setRenewing] = useState<InviteRow | null>(null)
  const [link, setLink] = useState<ShownLink | null>(null)
  const at = (iso: string) => formatInstant(iso, timeZone)

  const handledElsewhere = (reason: unknown) => {
    if (!(reason instanceof ApiError) || reason.code !== 'already_handled') return false
    toast.warning(reason.message)
    reload()
    return true
  }

  const when = ({ status: is, acceptedAt, revokedAt, expiresAt }: InviteRow) => {
    if (is === 'accepted' && acceptedAt) return `Accepted ${at(acceptedAt)}`
    if (is === 'revoked' && revokedAt) return `Revoked ${at(revokedAt)}`
    return `${is === 'expired' ? 'Expired' : 'Until'} ${at(expiresAt)}`
  }
  const columns: TableColumn<InviteRow>[] = [
    { id: 'name', header: 'Name', cell: ({ name }) => name, sortValue: ({ name }) => name },
    { id: 'email', header: 'Email', cell: ({ email }) => email, sortValue: ({ email }) => email },
    { id: 'role', header: 'Role', cell: ({ role }) => role, sortValue: ({ role }) => role },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <Badge tone={statuses[row.status].tone}>{statuses[row.status].label}</Badge>,
      sortValue: (row) => statuses[row.status].label,
    },
    { id: 'invited', header: 'Invited', cell: (row) => `${at(row.createdAt)} by ${row.invitedBy}`, sortValue: (row) => row.createdAt },
    { id: 'when', header: 'When', cell: when },
  ]
  const usable = ({ status: is }: InviteRow) => is === 'open' || is === 'expired' || is === 'void'

  return (
    <div className="panel">
      <div className="panel-head">
        <p>An invited person sets a password with a link and is in at once.</p>
        <Button variant="primary" icon="plus" onClick={() => setInviting(true)}>
          Invite someone
        </Button>
      </div>
      <Table
        caption="Invites"
        hideCaption
        columns={columns}
        rows={data?.invites ?? []}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        status={status}
        error={error}
        onRetry={reload}
        empty={{ icon: 'inbox', title: 'No invites', description: 'Nobody has been invited yet.' }}
        rowActions={(row) =>
          usable(row) && (
            <span className="row-actions">
              <Button size="small" onClick={() => setRenewing(row)} aria-label={`New link for ${row.name}`}>
                New link
              </Button>
              <Button size="small" onClick={() => setRevoking(row)} aria-label={`Revoke the invite of ${row.name}`}>
                Revoke
              </Button>
            </span>
          )
        }
      />
      {inviting && (
        <InviteDialog
          onClose={() => setInviting(false)}
          onInvited={(next) => {
            setInviting(false)
            setLink(next)
            reload()
          }}
        />
      )}
      <ConfirmDialog
        open={renewing !== null}
        onClose={() => setRenewing(null)}
        title="Make a new link?"
        message={`The link ${renewing?.name} has now stops working.`}
        confirmLabel="Make a new link"
        onConfirm={async () => {
          if (!renewing) return
          try {
            const made = await callApi<NewLink>('POST', `invites/${renewing.id}/link`)
            setLink({ ...made, kind: 'invite', name: renewing.name })
            reload()
          } catch (reason) {
            if (!handledElsewhere(reason)) throw new Error(errorMessage(reason), { cause: reason })
          }
        }}
      />
      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title={`Revoke the invite of ${revoking?.name ?? ''}?`}
        message="The link stops working."
        confirmLabel="Revoke invite"
        destructive
        onConfirm={async () => {
          if (!revoking) return
          try {
            setData(await callApi<{ invites: InviteRow[] }>('POST', `invites/${revoking.id}/revoke`))
            toast.success('Invite revoked')
          } catch (reason) {
            if (!handledElsewhere(reason)) throw new Error(errorMessage(reason), { cause: reason })
          }
        }}
      />
      <LinkDialog link={link} onClose={() => setLink(null)} />
    </div>
  )
}

const fields = ['name', 'email', 'roleId'] as const

interface InviteDialogProps {
  /** Filled in beforehand. */
  invitee?: Invitee
  onClose: () => void
  onInvited: (link: ShownLink) => void
}

export function InviteDialog({ invitee, onClose, onInvited }: InviteDialogProps) {
  const formId = useId()
  const { load, access, setAccess } = useAccess()
  const [name, setName] = useState(invitee?.name ?? '')
  const [email, setEmail] = useState(invitee?.email ?? '')
  const form = useForm('invite', fields)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        const made = await callApi<NewLink>('POST', 'invites', { name, email, ...accessBody(access) })
        onInvited({ ...made, kind: 'invite', name: name.trim() })
      },
      {
        name: name.trim() === '' ? 'Enter a name.' : null,
        email: email.trim() === '' ? 'Enter an email address.' : null,
      },
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite someone"
      closeOnOutsidePress={false}
      busy={form.busy}
      footer={
        <>
          <Button onClick={onClose} aria-disabled={form.busy || undefined}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={form.busy} loadingLabel="Making the invite" aria-disabled={!load.data || undefined}>
            Make invite link
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" noValidate onSubmit={submit}>
        <FormMessages form={form} />
        <TextField label="Name" autoComplete="off" required value={name} onChange={setName} {...form.field('name')} />
        <TextField
          label="Email"
          type="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={setEmail}
          {...form.field('email')}
        />
        <AccessFields load={load} value={access} onChange={setAccess} roleField={form.field('roleId')} disabled={form.busy} />
      </form>
    </Dialog>
  )
}
