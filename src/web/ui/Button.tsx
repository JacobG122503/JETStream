import { type ButtonHTMLAttributes, forwardRef, type MouseEvent, type ReactNode, useEffect, useRef } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { announce } from './announce'
import { classNames } from './classNames'
import { Icon, type IconName } from './Icon'
import './Button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive'
export type ButtonSize = 'small' | 'medium'

interface LookProps {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
}

function look({ variant = 'secondary', size = 'medium' }: LookProps, className?: string) {
  return classNames('btn', `btn-${variant}`, `btn-${size}`, className)
}

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>

interface BaseButtonProps extends LookProps, NativeButtonProps {
  /** Shows a busy indicator and ignores clicks. The button keeps its width and focus. */
  loading?: boolean
  /** Said to screen readers while loading. */
  loadingLabel?: string
}

export interface ButtonProps extends BaseButtonProps {
  children: ReactNode
}

export interface IconButtonProps extends BaseButtonProps {
  /** The accessible name. */
  label: string
  icon: IconName
}

const ButtonElement = forwardRef<HTMLButtonElement, BaseButtonProps & { children: ReactNode; 'aria-label'?: string }>(
  function ButtonElement(
    { variant, size, icon, loading = false, loadingLabel = 'Working', className, children, onClick, type = 'button', ...rest },
    ref,
  ) {
    const wasLoading = useRef(loading)
    useEffect(() => {
      if (loading && !wasLoading.current) announce(loadingLabel)
      wasLoading.current = loading
    }, [loading, loadingLabel])
    // Not `disabled`: that would lose keyboard focus.
    const inactive = loading || rest['aria-disabled'] === true

    return (
      <button
        {...rest}
        ref={ref}
        type={type}
        className={look({ variant, size }, classNames(loading && 'is-loading', className))}
        aria-busy={loading || undefined}
        aria-disabled={inactive || undefined}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          if (inactive) {
            // Also keeps a submit button from submitting again.
            event.preventDefault()
            event.stopPropagation()
            return
          }
          onClick?.(event)
        }}
      >
        <span className="btn-content">
          {icon && <Icon name={icon} />}
          {children}
        </span>
        {loading && <span className="spinner btn-spinner" aria-hidden="true" />}
      </button>
    )
  },
)

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  return <ButtonElement {...props} ref={ref} />
})

/** A button without text. `label` is required: it is the only name the button has. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, variant = 'quiet', ...rest },
  ref,
) {
  return (
    <ButtonElement {...rest} variant={variant} aria-label={label} className={classNames('btn-icon', className)} ref={ref}>
      {null}
    </ButtonElement>
  )
})

export interface LinkButtonProps extends LookProps, Omit<LinkProps, 'children'> {
  children: ReactNode
}

/** A link that looks like a button, for actions that go to another page. */
export function LinkButton({ variant, size, icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link {...rest} className={look({ variant, size }, className)}>
      <span className="btn-content">
        {icon && <Icon name={icon} />}
        {children}
      </span>
    </Link>
  )
}
