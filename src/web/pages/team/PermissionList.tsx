import { useId, useState } from 'react'
import { baseByArea, chooseLevel, choicesOf, countChoices, type Grants, permissionAreas, type PermissionArea, type PermissionChoice, permissionOf, reaches } from '../../../shared/permissions'
import { Checkbox, Icon } from '../../ui'

interface PermissionListProps {
  value: Grants
  onChange: (value: Grants) => void
  /** What the editor holds; more cannot be given. */
  held: Grants
  disabled: boolean
  /** Name of the profile, and back to what it gives. */
  profile: string
  onReset: () => void
  changed: boolean
}

/** Every permission to tick, by area. Areas open and close. */
export function PermissionList({ value, onChange, held, disabled, profile, onReset, changed }: PermissionListProps) {
  const [open, setOpen] = useState<readonly PermissionArea[]>([])
  const [note, setNote] = useState('')
  const total = countChoices(value)
  const allOpen = open.length === permissionAreas.length

  const tick = ({ key, level }: PermissionChoice, on: boolean) => {
    const { levels } = permissionOf(key)
    // Everything includes what they manage.
    const next = on ? level : level === 'all' && levels.includes('managed') ? 'managed' : null
    const change = chooseLevel(value, key, next)
    onChange(change.grants)
    const words = (keys: readonly PermissionChoice['key'][]) => keys.map((other) => `"${permissionOf(other).allows}"`).join(', ')
    setNote(
      [
        change.added.length > 0 && `Also switched on, because it is needed: ${words(change.added)}.`,
        change.removed.length > 0 && `Also switched off or lowered, because it needs this: ${words(change.removed)}.`,
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  return (
    <div className="permission-panel">
      <div className="permission-head">
        <p>{disabled ? 'What this profile allows.' : 'You can customize the permissions editing the list below.'}</p>
        <p className="muted" role="status">
          {total.on} of {total.of} enabled
        </p>
      </div>
      <p className="permission-links">
        <button type="button" className="link-button" onClick={() => setOpen(allOpen ? [] : permissionAreas)}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
        {!disabled && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className="link-button is-quiet"
              aria-disabled={!changed || undefined}
              onClick={() => {
                if (!changed) return
                onReset()
                setNote('')
              }}
            >
              Reset to {profile} defaults
            </button>
          </>
        )}
      </p>
      <p className="form-note permission-note" role="status">
        {note}
      </p>
      <div className="permission-areas">
        {permissionAreas.map((area) => (
          <Area
            key={area}
            area={area}
            open={open.includes(area)}
            onToggle={() => setOpen((before) => (before.includes(area) ? before.filter((other) => other !== area) : [...before, area]))}
            value={value}
            held={held}
            disabled={disabled}
            onTick={tick}
          />
        ))}
      </div>
    </div>
  )
}

interface AreaProps extends Pick<PermissionListProps, 'value' | 'held' | 'disabled'> {
  area: PermissionArea
  open: boolean
  onToggle: () => void
  onTick: (choice: PermissionChoice, on: boolean) => void
}

function Area({ area, open, onToggle, value, held, disabled, onTick }: AreaProps) {
  const id = useId()
  const { on, of } = countChoices(value, [area])
  const base = baseByArea[area]
  return (
    <div className="permission-area">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} />
          <span>{area}</span>
          <span className="permission-count">
            {on} of {of}
          </span>
        </button>
      </h3>
      {open && (
        <div id={id} className="permission-choices" role="group" aria-label={area}>
          {base && <Checkbox label={base} hint="Everyone can." checked disabled onChange={() => undefined} />}
          {choicesOf(area).map((choice) => {
            const { key, level, label } = choice
            const checked = reaches(value[key], level)
            const refused = !reaches(held[key], level)
            return (
              <Checkbox
                key={`${key}:${level}`}
                label={label}
                hint={!disabled && refused ? 'You do not have this yourself.' : undefined}
                checked={checked}
                disabled={disabled || refused}
                onChange={(next) => onTick(choice, next)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
