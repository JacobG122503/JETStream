import { useState } from 'react'
import { chooseLevel, type Grants, grantedKeys, isLevel, permissionAreas, permissionCatalogue, type PermissionKey, permissionOf, reaches } from '../../../shared/permissions'
import { Select } from '../../ui'

interface GrantsEditorProps {
  value: Grants
  onChange?: (value: Grants) => void
  /** What the editor holds; more cannot be given. */
  held: Grants
}

const levelNames = { managed: 'Managed', all: 'All' } as const

/** The permissions of a role in plain words, by area. Read-only without `onChange`. */
export function GrantsEditor({ value, onChange, held }: GrantsEditorProps) {
  const [note, setNote] = useState('')

  const choose = (key: PermissionKey, text: string) => {
    if (!onChange) return
    const change = chooseLevel(value, key, isLevel(text) ? text : null)
    onChange(change.grants)
    const words = (keys: PermissionKey[]) => keys.map((other) => `"${permissionOf(other).allows}"`).join(', ')
    setNote(
      [
        change.added.length > 0 && `Also chosen, because it is needed: ${words(change.added)}.`,
        change.removed.length > 0 && `Also taken away or lowered, because it needs this: ${words(change.removed)}.`,
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  return (
    <div className="grants">
      <p className="form-note grants-note" role="status">
        {note}
      </p>
      {permissionAreas.map((area) => (
        <fieldset key={area} className="grants-area">
          <legend>{area}</legend>
          {permissionCatalogue
            .filter((permission) => permission.area === area)
            .map(({ key, allows, levels }) => {
              const refused = levels.filter((level) => !reaches(held[key], level))
              return (
                <div key={key} className="grant">
                  <span className="grant-text">{allows}</span>
                  {onChange ? (
                    <Select
                      label={allows}
                      hideLabel
                      value={value[key] ?? 'none'}
                      hint={refused.length > 0 ? 'You do not have this yourself.' : undefined}
                      options={[
                        { value: 'none', label: 'None' },
                        ...levels.map((level) => ({ value: level, label: levels.length === 1 ? 'Yes' : levelNames[level], disabled: refused.includes(level) })),
                      ]}
                      onChange={(text) => choose(key, text)}
                    />
                  ) : (
                    <span className="grant-level">{value[key] === undefined ? 'None' : levels.length === 1 ? 'Yes' : levelNames[value[key]]}</span>
                  )}
                </div>
              )
            })}
        </fieldset>
      ))}
      <p className="sr-only">{grantedKeys(value).length} permissions chosen</p>
    </div>
  )
}
