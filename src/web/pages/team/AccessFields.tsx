import type { PeopleOptions } from '../../../shared/api'
import type { Load } from '../../auth/useLoad'
import { ErrorState, LoadingState, Select } from '../../ui'
import type { Access } from './access'
import { AssignmentPicker } from './AssignmentPicker'

interface AccessFieldsProps {
  load: Load<PeopleOptions>
  value: Access
  onChange: (value: Access) => void
  roleField: { id: string; error: string | null }
  disabled?: boolean
}

/** Role, and optionally clients and projects, for someone who is approved or invited. */
export function AccessFields({ load, value, onChange, roleField, disabled }: AccessFieldsProps) {
  const { status, data, error, reload } = load
  if (status === 'loading') return <LoadingState label="Loading roles and clients" />
  if (!data) return <ErrorState message={error} onRetry={reload} />
  return (
    <>
      <Select
        label="Role"
        required
        disabled={disabled}
        value={value.roleId}
        options={data.roles.map(({ id, name, allowed }) => ({ value: String(id), label: allowed ? name : `${name} (needs more access than you have)`, disabled: !allowed }))}
        onChange={(roleId) => onChange({ ...value, roleId })}
        {...roleField}
      />
      <fieldset className="stack">
        <legend className="field-label">Clients and projects (optional)</legend>
        <AssignmentPicker
          clients={data.clients}
          value={value}
          disabled={disabled}
          onChange={(choice) => onChange({ ...value, ...choice })}
        />
      </fieldset>
    </>
  )
}
