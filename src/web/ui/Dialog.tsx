import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconButton } from './Button'
import { classNames } from './classNames'
import { Icon } from './Icon'
import { useModalLayer } from './overlay/useModalLayer'
import './Dialog.css'

export interface DialogProps {
  open: boolean
  /** Escape, the close button and, unless turned off, a press outside. */
  onClose: () => void
  /** The accessible name. */
  title: string
  children: ReactNode
  /** Action buttons. They stay in view while the content scrolls. */
  footer?: ReactNode
  size?: 'small' | 'medium' | 'large'
  /** Turn off for dialogs that hold a form, so that a stray press does not lose what was typed. */
  closeOnOutsidePress?: boolean
  /** While true the dialog cannot be closed. */
  busy?: boolean
  /** Gets focus on opening; the dialog itself without it. */
  initialFocusRef?: RefObject<HTMLElement>
  /** Gets focus on closing when the element that had it before is gone; the page heading without it. */
  fallbackFocusRef?: RefObject<HTMLElement>
  /** Id of the text that explains the dialog. */
  describedBy?: string
}

export function Dialog({ open, ...rest }: DialogProps) {
  return open ? createPortal(<OpenDialog {...rest} />, document.body) : null
}

function OpenDialog({
  onClose, title, children, footer, size = 'medium', closeOnOutsidePress = true, busy = false, initialFocusRef, fallbackFocusRef, describedBy,
}: Omit<DialogProps, 'open'>) {
  const titleId = useId()
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const pressedOutside = useRef(false)
  const [scrolls, setScrolls] = useState(false)
  const close = () => {
    if (!busy) onClose()
  }
  useModalLayer({
    rootRef: root,
    panelRef: panel,
    initialFocus: () => initialFocusRef?.current,
    onEscape: close,
    fallbackFocusRef,
  })

  // Content that scrolls must be reachable with the keyboard, also without a control inside it.
  useEffect(() => {
    const element = body.current
    if (!element || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => setScrolls(element.scrollHeight > element.clientHeight))
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={root}
      className="dialog-layer"
      // Both, so that a drag that starts inside the dialog and ends outside does not close it.
      onMouseDown={(event) => (pressedOutside.current = event.target === event.currentTarget)}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedOutside.current && closeOnOutsidePress) close()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        tabIndex={-1}
        className={classNames('dialog', `dialog-${size}`)}
        aria-labelledby={titleId}
        aria-describedby={describedBy}
      >
        <div className="dialog-header">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          <IconButton icon="close" label="Close" className="dialog-close" aria-disabled={busy || undefined} onClick={close} />
        </div>
        <div
          ref={body}
          className="dialog-body"
          {...(scrolls ? { tabIndex: 0, role: 'group', 'aria-labelledby': titleId } : undefined)}
        >
          <div>{children}</div>
        </div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  )
}

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  title: string
  /** What will happen, and to what. */
  message: ReactNode
  /** Names the action, such as "Delete project". */
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  /** The dialog closes when this succeeds. When it rejects, the error's message is shown. */
  onConfirm: () => void | Promise<unknown>
  fallbackFocusRef?: RefObject<HTMLElement>
}

export function ConfirmDialog({ open, ...rest }: ConfirmDialogProps) {
  // Mounted only while open, so each opening starts without an old error.
  return open ? <OpenConfirmDialog {...rest} /> : null
}

function OpenConfirmDialog({
  onClose, title, message, confirmLabel, cancelLabel = 'Cancel', destructive = false, onConfirm, fallbackFocusRef,
}: Omit<ConfirmDialogProps, 'open'>) {
  const messageId = useId()
  const cancel = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    // A ref as well as state: a second click can come before the next render.
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : 'Something went wrong. Try again.')
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size="small"
      busy={busy}
      initialFocusRef={destructive ? cancel : confirm}
      fallbackFocusRef={fallbackFocusRef}
      describedBy={messageId}
      footer={
        <>
          <Button ref={cancel} onClick={onClose} aria-disabled={busy || undefined}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirm}
            variant={destructive ? 'destructive' : 'primary'}
            loading={busy}
            loadingLabel={`${confirmLabel}: working`}
            onClick={() => void run()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div id={messageId} className="confirm-message">
        {message}
      </div>
      {error && (
        <p className="confirm-error" role="alert">
          <Icon name="error" />
          <span>{error}</span>
        </p>
      )}
    </Dialog>
  )
}
