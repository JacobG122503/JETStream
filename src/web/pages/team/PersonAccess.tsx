import { useState } from 'react'
import type { AccessInput, PersonAccessDetails } from '../../../shared/api'
import { chooseExtra, managerExtras, type PermissionKey, permissionOf } from '../../../shared/permissions'
import { callApi } from '../../api'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Button, Card, Checkbox, ConfirmDialog, ErrorState, LoadingState, MultiCombobox, Notice, Select, Switch, useToast } from '../../ui'
import { accessLines, chosenGrants, projectLabel } from './accessWords'

interface PersonAccessProps {
  personId: number
  name: string
  onSaved: () => void
}

/** Role, extras and what someone manages, for those who may change access. */
export function PersonAccess({ personId, name, onSaved }: PersonAccessProps) {
  const { status, data, error, reload, setData } = useLoad<PersonAccessDetails>(`people/${personId}/access`)
  return (
    <Card title="Access">
      {status === 'loading' && <LoadingState look="skeleton" label="Loading the access" />}
      {status === 'error' && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <AccessForm
          key={data.state}
          personId={personId}
          name={name}
          details={data}
          onReload={reload}
          onSaved={(saved) => {
            setData(saved)
            onSaved()
          }}
        />
      )}
    </Card>
  )
}

const fields = ['roleId', 'extras', 'managedPersonIds', 'managedProjectIds'] as const

interface AccessFormProps {
  personId: number
  name: string
  details: PersonAccessDetails
  onReload: () => void
  onSaved: (saved: PersonAccessDetails) => void
}

function AccessForm({ personId, name, details, onReload, onSaved }: AccessFormProps) {
  const toast = useToast()
  const form = useForm(`access-${personId}`, fields)
  const [roleId, setRoleId] = useState(details.roleId)
  const [extras, setExtras] = useState<PermissionKey[]>(details.extras)
  const [managedPeople, setManagedPeople] = useState(details.managedPeople.map(({ id }) => String(id)))
  const [managedProjects, setManagedProjects] = useState(details.projects.filter(({ isManager }) => isManager).map(({ id }) => id))
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)

  const all = details.editable === 'all'
  const flags = details.editable !== 'none'
  const role = details.roles.find(({ id }) => id === roleId)
  const isManager = role?.builtIn === true && role.key === 'manager'
  const keptExtras = isManager ? extras : []
  const lostExtras = isManager ? [] : details.extras

  // Also those who are managed but not active any more, so that their names are shown.
  const choices = new Map([...details.people, ...details.managedPeople].map((person) => [person.id, person]))
  const nameOf = (id: string) => choices.get(Number(id))?.name ?? ''

  const setExtra = (key: PermissionKey, on: boolean) => {
    const change = chooseExtra(extras, key, on)
    setExtras(change.extras)
    const also = [...change.added.filter((extra) => managerExtras.includes(extra)), ...change.removed]
    const words = also.map((extra) => `"${permissionOf(extra).allows}"`).join(', ')
    setNote(also.length === 0 ? '' : on ? `Also switched on, because it is needed: ${words}.` : `Also switched off, because it needs this: ${words}.`)
  }

  const save = () =>
    form.submit(async () => {
      const body: AccessInput = {
        roleId, extras: keptExtras, managedPersonIds: managedPeople.map(Number), managedProjectIds: managedProjects, state: details.state,
      }
      const saved = await callApi<PersonAccessDetails>('PUT', `people/${personId}/access`, body)
      toast.success('Access saved')
      onSaved(saved)
    })

  const summary = accessLines({
    administrator: role?.builtIn === true && role.key === 'administrator',
    grants: chosenGrants(details, roleId, keptExtras),
    projects: details.projects.filter(({ id }) => managedProjects.includes(id)).map((project) => project.name),
    people: managedPeople.map(nameOf),
  })

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (lostExtras.length > 0) setConfirming(true)
        else void save()
      }}
    >
      <FormMessages form={form} onReload={onReload} />
      {details.reason && <Notice tone="info">{details.reason}</Notice>}
      <Select
        label="Role"
        value={String(roleId)}
        disabled={!all}
        options={details.roles.map((option) => ({
          value: String(option.id),
          label: option.refusal !== null && option.id !== details.roleId ? `${option.name} (needs more access than you have)` : option.name,
          disabled: option.refusal !== null && option.id !== details.roleId,
        }))}
        onChange={(value) => setRoleId(Number(value))}
        {...form.field('roleId')}
      />
      {isManager && (
        <fieldset className="stack">
          <legend className="field-label">Extras</legend>
          <div className="extras-grid">
            {managerExtras.map((key) => (
              <Checkbox
                key={key}
                label={permissionOf(key).allows}
                hint={details.refusedExtras.includes(key) ? 'You do not have this yourself.' : undefined}
                checked={extras.includes(key)}
                disabled={!all || details.refusedExtras.includes(key)}
                onChange={(on) => setExtra(key, on)}
              />
            ))}
          </div>
          <p className="form-note" role="status">
            {note}
          </p>
        </fieldset>
      )}
      <MultiCombobox
        label="Manages these people"
        placeholder="Search people"
        disabled={!all}
        value={managedPeople}
        options={[...choices.values()].map(({ id, name: label, active }) => ({ value: String(id), label: active ? label : `${label} (not active)` }))}
        onChange={setManagedPeople}
        {...form.field('managedPersonIds')}
      />
      {details.projects.length > 0 && (
        <fieldset className="stack">
          <legend className="field-label">Manages these projects</legend>
          <div className="extras-grid">
            {details.projects.map((project) => (
              <Switch
                key={project.id}
                label={projectLabel(project)}
                checked={managedProjects.includes(project.id)}
                disabled={!flags}
                onChange={(on) => setManagedProjects((before) => (on ? [...before, project.id] : before.filter((id) => id !== project.id)))}
              />
            ))}
          </div>
        </fieldset>
      )}
      <AccessSummary title={`What ${name} can do`} lines={summary} />
      {flags && (
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving access">
            Save access
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Take the extras of ${name} away?`}
        message={
          <>
            <p>Only people with the role Manager have extras. These are removed:</p>
            <ul className="confirm-list">
              {lostExtras.map((key) => (
                <li key={key}>{permissionOf(key).allows}</li>
              ))}
            </ul>
          </>
        }
        confirmLabel="Remove and save"
        destructive
        onConfirm={async () => {
          setConfirming(false)
          await save()
        }}
      />
    </form>
  )
}

export function AccessSummary({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section className="access-summary">
      <h3>{title}</h3>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
}
