import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconButton } from './Button'
import { Icon, type IconName } from './Icon'
import { canTakeFocus, focusPageHeading, tabbable } from './overlay/focus'
import { layerExemptAttribute } from './overlay/layers'
import { type ToastApi, ToastContext, type ToastKind, type ToastOptions } from './toastContext'
import './Toasts.css'

const visibleLimit = 3
const lifetimeMs = 5000

interface Toast extends ToastOptions {
  id: number
  kind: ToastKind
  message: string
}

const kinds: Record<ToastKind, { icon: IconName; word: string; stays: boolean }> = {
  success: { icon: 'success', word: 'Success', stays: false },
  info: { icon: 'info', word: 'Information', stays: false },
  warning: { icon: 'warning', word: 'Warning', stays: true },
  error: { icon: 'error', word: 'Error', stays: true },
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const region = useRef<HTMLDivElement>(null)
  /** What had focus before it moved into the toasts. */
  const focusBefore = useRef<Element | null>(null)
  // Hover and focus hold all toasts, not only the one in question: others leaving would move it
  // away from under the pointer.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  // An element that is removed under the pointer does not tell that the pointer left it.
  useEffect(() => {
    if (!hovered) return
    const onPointerMove = (event: PointerEvent) => {
      if (!region.current?.contains(event.target as Node)) setHovered(false)
    }
    document.addEventListener('pointermove', onPointerMove)
    return () => document.removeEventListener('pointermove', onPointerMove)
  }, [hovered])

  const api = useMemo<ToastApi>(() => {
    const add = (kind: ToastKind) => (message: string, options?: ToastOptions) =>
      setToasts((current) => [...current, { ...options, id: nextId++, kind, message }])
    return { success: add('success'), info: add('info'), warning: add('warning'), error: add('error') }
  }, [])

  const remove = (id: number) => {
    const hadFocus = region.current?.contains(document.activeElement)
    setToasts((current) => current.filter((toast) => toast.id !== id))
    setHovered(false)
    if (!hadFocus) return
    setFocused(false)
    // After the toast is gone: on to the next one, or back to where the person came from.
    setTimeout(() => {
      if (document.activeElement !== null && document.activeElement !== document.body) return
      const next = region.current ? tabbable(region.current)[0] : undefined
      if (next) next.focus()
      else if (canTakeFocus(focusBefore.current)) focusBefore.current.focus()
      else focusPageHeading()
    })
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          {...{ [layerExemptAttribute]: '' }}
          ref={region}
          className="toasts"
          role="region"
          aria-label="Notifications"
          // Pressing a button with the pointer leaves focus where the person was working.
          onMouseDown={(event) => {
            if ((event.target as Element).closest('button')) event.preventDefault()
          }}
          onPointerOver={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onBlur={(event) => setFocused(event.currentTarget.contains(event.relatedTarget))}
          onFocus={(event) => {
            setFocused(true)
            if (!event.currentTarget.contains(event.relatedTarget)) focusBefore.current = event.relatedTarget
          }}
        >
          {toasts.slice(0, visibleLimit).map((toast) => (
            <ToastItem key={toast.id} toast={toast} paused={hovered || focused} onDismiss={() => remove(toast.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

interface ToastItemProps {
  toast: Toast
  paused: boolean
  onDismiss: () => void
}

function ToastItem({ toast, paused, onDismiss }: ToastItemProps) {
  const { icon, word, stays } = kinds[toast.kind]
  const remaining = useRef(lifetimeMs)
  const dismiss = useRef(onDismiss)
  useEffect(() => {
    dismiss.current = onDismiss
  })

  useEffect(() => {
    if (stays || paused) return
    const begin = Date.now()
    const timer = setTimeout(() => dismiss.current(), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current -= Date.now() - begin
    }
  }, [stays, paused])

  // An alert is announced when it appears. A polite status is announced when its content changes,
  // so its text comes a moment after it.
  const [filled, setFilled] = useState(stays)
  useEffect(() => {
    const timer = setTimeout(() => setFilled(true), 60)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      className={`toast toast-${toast.kind}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        // Not for a dialog behind the toast.
        event.preventDefault()
        onDismiss()
      }}
    >
      <Icon name={icon} className="toast-icon" />
      <div className="toast-content">
        <div className="toast-message" role={stays ? 'alert' : 'status'} aria-atomic="true">
          {filled && (
            <>
              <span className="toast-word">{word}</span> <span>{toast.message}</span>
            </>
          )}
        </div>
        {toast.action && (
          <Button
            size="small"
            className="toast-action"
            onClick={() => {
              toast.action?.onAction()
              onDismiss()
            }}
          >
            {toast.action.label}
          </Button>
        )}
      </div>
      <IconButton icon="close" size="small" label={`Dismiss: ${toast.message}`} className="toast-dismiss" onClick={onDismiss} />
    </div>
  )
}
