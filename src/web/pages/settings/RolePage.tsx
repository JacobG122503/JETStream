import { type FormEvent, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { roleDescriptionLength, roleNameLength } from '../../../shared/accounts'
import type { RoleDetails, RoleSummary } from '../../../shared/api'
import { compareGrants, describePermission, everything, grantedKeys, type Grants, managerExtras, permissionOf } from '../../../shared/permissions'
import { callApi } from '../../api'
import { useAuth, usePerson } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Button, Card, ConfirmDialog, Dialog, ErrorState, LinkButton, LoadingState, Notice, Select, TextArea, TextField, useToast } from '../../ui'
import { GrantsEditor } from './GrantsEditor'
import './settings.css'

const back = (
  <LinkButton to="/settings/roles" icon="chevronLeft">
    Roles
  </LinkButton>
)

/** An existing role, or a new one, empty or a copy of ?from=id. */
export function RolePage() {
  const { id = '' } = useParams()
  const [query] = useSearchParams()
  const from = query.get('from')
  if (id === 'new' && from === null) return <RoleForm key="new" role={null} />
  return <RoleLoader key={`${id} ${from}`} id={id === 'new' ? (from ?? '') : id} copy={id === 'new'} />
}

function RoleLoader({ id, copy }: { id: string; copy: boolean }) {
  const { status, data, error, reload } = useLoad<RoleDetails>(`roles/${encodeURIComponent(id)}`)
  if (data) return <RoleForm key={data.version} role={data} copy={copy} onReload={reload} />
  return (
    <Page title="Role" actions={back}>
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the role" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error === 'Not found' ? 'There is no such role.' : error} onRetry={reload} />}
    </Page>
  )
}

const fields = ['name', 'description', 'grants'] as const

interface RoleFormProps {
  role: RoleDetails | null
  copy?: boolean
  onReload?: () => void
}

function RoleForm({ role, copy = false, onReload }: RoleFormProps) {
  const existing = copy ? null : role
  const { permissions } = usePerson()
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const form = useForm('role', fields)
  const administrator = role?.key === 'administrator'
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [grants, setGrants] = useState<Grants>(role ? (administrator ? everything() : role.grants) : {})
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const readOnly = existing !== null && existing.refusal !== null
  const { gained, lost } = compareGrants(existing?.grants ?? {}, grants)
  const nothingChosen = grantedKeys(grants).length === 0

  const save = () =>
    form.submit(
      async () => {
        const body = { name, description, grants }
        if (existing) await callApi<RoleDetails>('PUT', `roles/${existing.id}`, { ...body, version: existing.version })
        else await callApi<RoleDetails>('POST', 'roles', body)
        toast.success(existing ? 'Role saved' : 'Role created')
        void refresh()
        navigate('/settings/roles')
      },
      { name: name.trim() === '' ? 'Enter a name.' : null },
    )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (existing && existing.people > 0 && name.trim() !== '') setConfirming(true)
    else void save()
  }

  return (
    <Page
      title={existing ? existing.name : copy ? `Copy of ${role?.name ?? ''}` : 'New role'}
      description={readOnly ? existing.description : undefined}
      actions={
        <>
          {back}
          {existing && <LinkButton to={`/settings/roles/new?from=${existing.id}`} icon="copy">Duplicate</LinkButton>}
          {existing && !readOnly && <Button variant="destructive" icon="trash" onClick={() => setDeleting(true)}>Delete</Button>}
        </>
      }
    >
      {readOnly && existing.refusal && <Notice tone="info">{existing.refusal}</Notice>}
      {readOnly ? (
        <Card title="Permissions">
          {administrator ? (
            <p>Can do everything.</p>
          ) : (
            <>
              <GrantsEditor value={grants} held={permissions} />
              {existing.key === 'manager' && (
                <div className="stack">
                  <h3>Extras that can be switched on for one person</h3>
                  <ul className="access-list">
                    {managerExtras.map((key) => (
                      <li key={key}>{permissionOf(key).allows}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Card>
      ) : (
        <form className="stack" noValidate onSubmit={submit}>
          <FormMessages form={form} onReload={onReload} />
          <Card title="Role">
            <div className="stack">
              <TextField label="Name" required maxLength={roleNameLength} value={name} onChange={setName} {...form.field('name')} />
              <TextArea label="Description" rows={2} maxLength={roleDescriptionLength} value={description} onChange={setDescription} {...form.field('description')} />
            </div>
          </Card>
          <Card title="Permissions">
            <GrantsEditor value={grants} onChange={setGrants} held={permissions} />
          </Card>
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving the role">
              {existing ? 'Save role' : 'Create role'}
            </Button>
            {nothingChosen && <p className="form-note">Without permissions, people have only what everyone has.</p>}
          </div>
        </form>
      )}
      {existing && (
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title={`Change the role of ${existing.people === 1 ? '1 person' : `${existing.people} people`}?`}
          message={
            <>
              <Changes title="They gain" grants={gained} />
              <Changes title="They lose" grants={lost} />
              {grantedKeys(gained).length + grantedKeys(lost).length === 0 && <p>What they may do stays the same.</p>}
            </>
          }
          confirmLabel="Save role"
          onConfirm={async () => {
            setConfirming(false)
            await save()
          }}
        />
      )}
      {existing && deleting && <DeleteRole role={existing} onClose={() => setDeleting(false)} />}
    </Page>
  )
}

function Changes({ title, grants }: { title: string; grants: Grants }) {
  const keys = grantedKeys(grants)
  if (keys.length === 0) return null
  return (
    <>
      <p>{title}:</p>
      <ul className="confirm-list">
        {keys.map((key) => (
          <li key={key}>{describePermission(key, grants[key] ?? 'managed')}</li>
        ))}
      </ul>
    </>
  )
}

const deleteFields = ['replacementId'] as const

function DeleteRole({ role, onClose }: { role: RoleDetails; onClose: () => void }) {
  const others = useLoad<{ roles: RoleSummary[] }>('roles')
  const [replacement, setReplacement] = useState('')
  const form = useForm('delete-role', deleteFields)
  const navigate = useNavigate()
  const toast = useToast()
  const inUse = role.people + role.invites > 0
  const remove = () =>
    form.submit(
      async () => {
        await callApi('POST', `roles/${role.id}/delete`, { version: role.version, replacementId: inUse ? Number(replacement) : null })
        toast.success('Role deleted')
        navigate('/settings/roles')
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
