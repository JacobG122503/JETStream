import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { announce } from './announce'
import { IconButton } from './Button'
import { classNames } from './classNames'
import { type ComboboxOption, filterOptions } from './comboboxFilter'
import { FieldFrame, type FieldProps, useFieldIds } from './Field'
import { Icon } from './Icon'
import { popupAttributes, usePopup } from './overlay/usePopup'
import './Combobox.css'
import './popup.css'

interface BaseProps extends FieldProps {
  options: ComboboxOption[]
  placeholder?: string
  readOnly?: boolean
}

export interface ComboboxProps extends BaseProps {
  /** Value of the chosen option, or null. */
  value: string | null
  onChange: (value: string | null) => void
}

export interface MultiComboboxProps extends BaseProps {
  value: string[]
  onChange: (value: string[]) => void
}

/** Chooses one of many options by typing part of its name. */
export function Combobox({ value, onChange, ...rest }: ComboboxProps) {
  return (
    <ComboboxBase
      {...rest}
      multiple={false}
      selected={value === null ? [] : [value]}
      onChange={(values) => onChange(values[0] ?? null)}
    />
  )
}

/** Chooses several of many options; each choice is shown with a button that removes it. */
export function MultiCombobox({ value, onChange, ...rest }: MultiComboboxProps) {
  return <ComboboxBase {...rest} multiple selected={value} onChange={onChange} />
}

interface ComboboxBaseProps extends BaseProps {
  multiple: boolean
  selected: string[]
  onChange: (values: string[]) => void
}

function ComboboxBase({
  label, hideLabel, hint, error, required, disabled, id, className, options, placeholder, readOnly, multiple, selected, onChange,
}: ComboboxBaseProps) {
  const ids = useFieldIds({ id, hint, error })
  const listId = useId()
  const anchor = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  /** What was typed; null while the field shows the chosen option. */
  const [query, setQuery] = useState<string | null>(null)
  const [activeValue, setActiveValue] = useState<string | null>(null)

  const matches = useMemo(() => filterOptions(options, query ?? ''), [options, query])
  const labelOf = (value: string) => options.find((option) => option.value === value)?.label ?? value
  const chosenLabel = !multiple && selected[0] !== undefined ? labelOf(selected[0]) : ''
  const editable = !disabled && !readOnly
  const activeIndex = matches.findIndex((option) => option.value === activeValue)
  const optionId = (index: number) => `${listId}-${index}`

  const close = () => {
    setOpen(false)
    setQuery(null)
    setActiveValue(null)
  }
  const show = () => {
    if (editable) setOpen(true)
  }
  const style = usePopup({ open, anchorRef: anchor, popupRef: popup, matchWidth: true, onPressOutside: close })

  useEffect(() => {
    if (!open || query === null) return
    const timer = setTimeout(
      () => announce(matches.length === 0 ? 'No matches' : matches.length === 1 ? '1 match' : `${matches.length} matches`),
      400,
    )
    return () => clearTimeout(timer)
  }, [open, query, matches.length])

  // Keeps the active option in view without scrolling the page.
  useEffect(() => {
    const list = popup.current
    const option = list?.querySelector<HTMLElement>('.is-active')
    if (!list || !option) return
    const top = option.offsetTop
    if (top < list.scrollTop + option.offsetHeight) list.scrollTop = top - option.offsetHeight
    else if (top + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + option.offsetHeight - list.clientHeight
    }
  }, [activeValue, open])

  const choose = (option: ComboboxOption) => {
    if (option.disabled) return
    if (multiple) {
      const has = selected.includes(option.value)
      onChange(has ? selected.filter((value) => value !== option.value) : [...selected, option.value])
      announce(has ? `${option.label} removed` : `${option.label} added`)
      setQuery(null)
      setActiveValue(option.value)
    } else {
      onChange([option.value])
      close()
    }
    input.current?.focus()
  }

  const move = (step: 1 | -1) => {
    const enabled = matches.filter((option) => !option.disabled)
    const index = enabled.findIndex((option) => option.value === activeValue)
    const next = index === -1 ? (step === 1 ? 0 : enabled.length - 1) : (index + step + enabled.length) % enabled.length
    setActiveValue(enabled[next]?.value ?? null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!editable || event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (open) move(event.key === 'ArrowDown' ? 1 : -1)
      else {
        show()
        // Opens at the chosen option, or at the first or last one.
        const chosen = multiple ? undefined : matches.find((option) => option.value === selected[0])
        if (chosen) setActiveValue(chosen.value)
        else move(event.key === 'ArrowDown' ? 1 : -1)
      }
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      const option = matches[activeIndex]
      if (option) choose(option)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
    } else if (event.key === 'Backspace' && multiple && !query && selected.length > 0) {
      onChange(selected.slice(0, -1))
      announce(`${labelOf(selected.at(-1) ?? '')} removed`)
    }
  }

  const clearable = editable && (selected.length > 0 || Boolean(query))

  return (
    <FieldFrame {...{ ids, label, hideLabel, hint, error, required, className }}>
      <div
        ref={anchor}
        className={classNames('combobox', multiple && 'combobox-multi')}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) close()
        }}
      >
        {multiple && selected.length > 0 && (
          <ul className="chips" aria-label={`${label}: chosen`}>
            {selected.map((value) => (
              <li key={value} className="chip">
                <span className="chip-label">{labelOf(value)}</span>
                {editable && (
                  <IconButton
                    icon="close"
                    size="small"
                    label={`Remove ${labelOf(value)}`}
                    className="chip-remove"
                    onClick={() => {
                      onChange(selected.filter((other) => other !== value))
                      announce(`${labelOf(value)} removed`)
                      input.current?.focus()
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="control-wrap">
          <input
            ref={input}
            id={ids.controlId}
            type="text"
            role="combobox"
            className={classNames('control', clearable ? 'control-has-2-buttons' : 'control-has-1-button')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-invalid={ids.invalid}
            aria-describedby={ids.describedBy}
            aria-required={required || undefined}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            title={query === null && chosenLabel ? chosenLabel : undefined}
            value={query ?? chosenLabel}
            onFocus={(event) => event.currentTarget.select()}
            onClick={show}
            onKeyDown={onKeyDown}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveValue(null)
              show()
            }}
          />
          <div className="control-buttons">
            {clearable && (
              <IconButton
                icon="close"
                label={`Clear ${label}`}
                className="control-button"
                onClick={() => {
                  onChange([])
                  close()
                  input.current?.focus()
                }}
              />
            )}
            {!readOnly && (
              <IconButton
                icon="chevronDown"
                label={open ? `Hide options for ${label}` : `Show options for ${label}`}
                className="control-button"
                disabled={disabled}
                // The arrow keys do this from the field.
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  input.current?.focus()
                  if (open) close()
                  else show()
                }}
              />
            )}
          </div>
        </div>
        {open && (
          <div
            {...popupAttributes}
            ref={popup}
            className="popup combobox-popup"
            style={style}
            // The element that scrolls is the list itself, which the field controls.
            id={listId}
            {...(matches.length > 0 && { role: 'listbox', 'aria-label': label, 'aria-multiselectable': multiple || undefined })}
            // Pressing the mouse on an option must not take focus from the field.
            onMouseDown={(event) => event.preventDefault()}
          >
            {matches.length === 0 ? (
              <p className="combobox-empty">No matches</p>
            ) : (
              <Options
                {...{ listId, matches, selected, activeValue, optionId }}
                onChoose={choose}
              />
            )}
          </div>
        )}
      </div>
    </FieldFrame>
  )
}

interface OptionsProps {
  listId: string
  matches: ComboboxOption[]
  selected: string[]
  activeValue: string | null
  optionId: (index: number) => string
  onChoose: (option: ComboboxOption) => void
}

function Options({ listId, matches, selected, activeValue, optionId, onChoose }: OptionsProps) {
  const groups: { name: string | undefined; options: { option: ComboboxOption; index: number }[] }[] = []
  matches.forEach((option, index) => {
    const last = groups.at(-1)
    if (last && last.name === option.group) last.options.push({ option, index })
    else groups.push({ name: option.group, options: [{ option, index }] })
  })

  const renderOption = ({ option, index }: { option: ComboboxOption; index: number }) => {
    const isSelected = selected.includes(option.value)
    return (
      <div
        key={option.value}
        id={optionId(index)}
        role="option"
        className={classNames('option', option.value === activeValue && 'is-active', isSelected && 'is-selected')}
        aria-selected={isSelected}
        aria-disabled={option.disabled || undefined}
        onClick={() => onChoose(option)}
      >
        <span className="option-label">{option.label}</span>
        {isSelected && <Icon name="check" />}
      </div>
    )
  }

  return (
    <>
      {groups.map((group, groupIndex) =>
        group.name === undefined ? (
          group.options.map(renderOption)
        ) : (
          <div key={group.name} role="group" aria-labelledby={`${listId}-group-${groupIndex}`}>
            <div className="option-group" id={`${listId}-group-${groupIndex}`}>
              {group.name}
            </div>
            {group.options.map(renderOption)}
          </div>
        ),
      )}
    </>
  )
}
