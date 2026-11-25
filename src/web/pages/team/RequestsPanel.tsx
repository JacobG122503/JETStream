import { type FormEvent, useId, useRef, useState } from 'react'
import type { JoinRequest, JoinRequests } from '../../../shared/api'
import { productName } from '../../../shared/product'
import { ApiError, callApi, errorMessage } from '../../api'
import { usePerson } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { formatInstant } from '../../auth/timeZones'
import type { Load } from '../../auth/useLoad'
import { useForm } from '../../auth/useForm'
import { Button, ConfirmDialog, Dialog, ErrorState, LoadingState, Notice, Switch, Table, type TableColumn, useToast } from '../../ui'
import { accessBody, useAccess } from './access'
import { AccessFields } from './AccessFields'

export function RequestsPanel({ load }: { load: Load<JoinRequests> }) {
  const { status, data, error, reload, setData } = load
  const { timeZone } = usePerson()
  const toast = useToast()
  const [approving, setApproving] = useState<JoinRequest | null>(null)
  const [declining, setDeclining] = useState<JoinRequest | null>(null)
  /** Not `disabled` meanwhile: the switch would lose focus. */
  const switching = useRef(false)

  const handledElsewhere = (reason: unknown) => {
    if (reason instanceof ApiError && reason.code === 'already_handled') {
      toast.warning(reason.message)
      reload()
      return true
    }
    return false
  }

  const switchSignUp = async (enabled: boolean) => {
    if (switching.current) return
    switching.current = true
    try {
      setData(await callApi<JoinRequests>('PUT', 'requests/enabled', { enabled }))
      toast.success(enabled ? 'Requests to join are on' : 'Requests to join are off')
    } catch (reason) {
      toast.error(errorMessage(reason))
    }
    switching.current = false
  }

  const columns: TableColumn<JoinRequest>[] = [
    { id: 'name', header: 'Name', cell: ({ name }) => name, sortValue: ({ name }) => name },
    { id: 'email', header: 'Email', cell: ({ email }) => email, sortValue: ({ email }) => email },
    { id: 'requestedAt', header: 'Asked', cell: (row) => formatInstant(row.requestedAt, timeZone), sortValue: (row) => row.requestedAt },
  ]

  if (status === 'loading') return <LoadingState look="skeleton" label="Loading requests" />
  if (!data) return <ErrorState message={error} onRetry={reload} />
  return (
    <div className="panel">
      <Switch
        label="People can ask for an account"
        hint="When off, people can join only with an invite."
        checked={data.enabled}
        onChange={(on) => void switchSignUp(on)}
      />
      {data.requests.length > 0 && (
        <Notice tone="warning">The email addresses are not verified. Approve only people you know have asked.</Notice>
      )}
      <Table
        caption="Requests to join"
        hideCaption
        columns={columns}
        rows={data.requests}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        empty={{ icon: 'inbox', title: 'No requests', description: 'Nobody is waiting for approval.' }}
        rowActions={(row) => (
          <span className="row-actions">
            <Button size="small" variant="primary" onClick={() => setApproving(row)} aria-label={`Approve ${row.name}`}>
              Approve
            </Button>
            <Button size="small" onClick={() => setDeclining(row)} aria-label={`Decline ${row.name}`}>
              Decline
            </Button>
          </span>
        )}
      />
      {approving && (
        <ApproveDialog
          request={approving}
          onClose={() => setApproving(null)}
          onApproved={(next) => {
            setData(next)
            setApproving(null)
            toast.success(`${approving.name} was approved`)
          }}
          onFailed={(reason) => {
            if (handledElsewhere(reason)) setApproving(null)
          }}
        />
      )}
      <ConfirmDialog
        open={declining !== null}
        onClose={() => setDeclining(null)}
        title={`Decline ${declining?.name ?? ''}?`}
        message={`The request of ${declining?.name} (${declining?.email}) is removed. The address can be used again.`}
        confirmLabel="Decline request"
        destructive
        onConfirm={async () => {
          if (!declining) return
          try {
            setData(await callApi<JoinRequests>('POST', `requests/${declining.id}/decline`))
            toast.success('Request declined')
          } catch (reason) {
            if (!handledElsewhere(reason)) throw reason
          }
        }}
      />
    </div>
  )
}

const fields = ['roleId'] as const

interface ApproveDialogProps {
  request: JoinRequest
  onClose: () => void
  onApproved: (next: JoinRequests) => void
  onFailed: (reason: unknown) => void
}

function ApproveDialog({ request, onClose, onApproved, onFailed }: ApproveDialogProps) {
  const formId = useId()
  const { load, access, setAccess } = useAccess()
  const form = useForm('approve', fields)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(async () => {
      try {
        onApproved(await callApi<JoinRequests>('POST', `requests/${request.id}/approve`, accessBody(access)))
      } catch (reason) {
        onFailed(reason)
        throw reason
      }
    })
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Approve ${request.name}`}
      closeOnOutsidePress={false}
      busy={form.busy}
      footer={
        <>
          <Button onClick={onClose} aria-disabled={form.busy || undefined}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={form.busy} loadingLabel="Approving" aria-disabled={!load.data || undefined}>
            Approve
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" noValidate onSubmit={submit}>
        <FormMessages form={form} />
        <p>
          {request.name} ({request.email}) can use {productName} once approved. The address is not verified.
        </p>
        <AccessFields load={load} value={access} onChange={setAccess} roleField={form.field('roleId')} disabled={form.busy} />
      </form>
    </Dialog>
  )
}
