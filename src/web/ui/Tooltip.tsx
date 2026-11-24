import { cloneElement, type ReactElement, useEffect, useId, useRef, useState } from 'react'
import { classNames } from './classNames'
import { popupAttributes, usePopup } from './overlay/usePopup'
import './Tooltip.css'

export interface TooltipProps {
  text: string
  /** One element that can take focus. */
  children: ReactElement<{ 'aria-describedby'?: string }>
}

const showDelayMs = 300
const hideDelayMs = 120

/** A short explanation on hover and focus. Never the only place for something people need. */
export function Tooltip({ text, children }: TooltipProps) {
  const id = useId()
  const anchor = useRef<HTMLSpanElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const [open, setOpen] = useState(false)
  const style = usePopup({ open, anchorRef: anchor, popupRef: popup, align: 'center', side: 'above' })

  const later = (next: boolean, delay: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), delay)
  }
  const now = (next: boolean) => {
    clearTimeout(timer.current)
    setOpen(next)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Only the tooltip goes, not a dialog around it.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  return (
    <span
      ref={anchor}
      className="tooltip-anchor"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') later(true, showDelayMs)
      }}
      // The delay lets the pointer move onto the tooltip.
      onPointerLeave={() => later(false, hideDelayMs)}
      onFocus={() => now(true)}
      onBlur={() => now(false)}
      onClick={() => now(false)}
    >
      {cloneElement(children, {
        'aria-describedby': classNames(children.props['aria-describedby'], id),
      })}
      {/* Described also while not shown, so the description is there when focus arrives. */}
      <span id={id} hidden>
        {text}
      </span>
      {open && (
        <div {...popupAttributes} ref={popup} role="tooltip" className="tooltip" style={style}>
          {text}
        </div>
      )}
    </span>
  )
}
