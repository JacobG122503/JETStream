import { useState } from 'react'
import type { RoleDetails, RoleSummary } from '../../../shared/api'
import { callApi } from '../../api'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Button, Dialog, Select, useToast } from '../../ui'

const deleteFields = ['replacementId'] as const

/** Deletes a role; whoever has it gets another. */
export function DeleteRole({ role, onClose, onDeleted }: { role: RoleDetails; onClose: () => void; onDeleted: () => void }) {
  const others = useLoad<{ roles: RoleSummary[] }>('roles')
  const [replacement, setReplacement] = useState('')
  const form = useForm('delete-role', deleteFields)
  const toast = useToast()
  const inUse = role.people + role.invites > 0
  const remove = () =>
    form.submit(
      async () => {
        await callApi('POST', `roles/${role.id}/delete`, { version: role.version, replacementId: inUse ? Number(replacement) : null })
        toast.success('Role deleted')
        onDeleted()
      },
      { replacementId: inUse && replacement === '' ? 'Choose another role.' : null },
    )
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete ${role.name}?`}
      busy={form.busy}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="destructive" loading={form.busy} loadingLabel="Deleting the role" onClick={() => void remove()}>
            Delete role
          </Button>
        </>
      }
    >
      <div className="stack">
        <FormMessages form={form} />
        {inUse ? (
          <>
            <p>
              {role.people} people and {role.invites} open invites use this role. Choose the role they get instead.
            </p>
            <Select
              label="Other role"
              placeholder="Choose a role"
              value={replacement}
              options={(others.data?.roles ?? []).filter(({ id }) => id !== role.id).map(({ id, name }) => ({ value: String(id), label: name }))}
              onChange={setReplacement}
              {...form.field('replacementId')}
            />
          </>
        ) : (
          <p>Nobody has this role.</p>
        )}
      </div>
    </Dialog>
  )
}
