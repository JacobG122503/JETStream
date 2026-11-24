import type { ReactNode } from 'react'
import { Button } from './Button'
import { classNames } from './classNames'
import { Icon, type IconName } from './Icon'
import './states.css'

/** `page` fills a page, `section` fits a card, table or tab. */
type StateSize = 'page' | 'section'

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="loading-inline" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}...</span>
    </span>
  )
}

/** Grey lines where text will be. Put it inside a LoadingState, which announces it. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <span className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, line) => (
        <span key={line} className="skeleton-line" />
      ))}
    </span>
  )
}

export interface LoadingStateProps {
  /** What is loading, such as "Loading invoices". */
  label?: string
  size?: StateSize
  look?: 'spinner' | 'skeleton'
}

export function LoadingState({ label = 'Loading', size = 'section', look = 'spinner' }: LoadingStateProps) {
  return (
    <div className={classNames('state', `state-${size}`, look === 'skeleton' && 'state-skeleton')} role="status">
      {look === 'skeleton' ? (
        <>
          <span className="sr-only">{label}...</span>
          <Skeleton lines={size === 'page' ? 8 : 4} />
        </>
      ) : (
        <span className="loading-inline">
          <span className="spinner" aria-hidden="true" />
          <span>{label}...</span>
        </span>
      )}
    </div>
  )
}

interface MessageProps {
  title: string
  /** Level of the title's heading. Without it the title is not a heading. */
  headingLevel?: 2 | 3 | 4
  size?: StateSize
}

function StateTitle({ title, headingLevel }: Pick<MessageProps, 'title' | 'headingLevel'>) {
  const Element = headingLevel ? (`h${headingLevel}` as const) : 'p'
  return <Element className="state-title">{title}</Element>
}

export interface EmptyStateProps extends MessageProps {
  description: ReactNode
  icon?: IconName
  action?: ReactNode
}

export function EmptyState({ title, headingLevel, description, icon = 'inbox', action, size = 'section' }: EmptyStateProps) {
  return (
    <div className={`state state-${size}`}>
      <span className="state-art">
        <Icon name={icon} />
      </span>
      <StateTitle {...{ title, headingLevel }} />
      <div className="state-text">{description}</div>
      {action && <div className="state-action">{action}</div>}
    </div>
  )
}

export interface ErrorStateProps extends Partial<MessageProps> {
  /** What went wrong, in words the reader can use. */
  message: ReactNode
  onRetry: () => void
  retryLabel?: string
  retrying?: boolean
}

export function ErrorState({
  title = 'Something went wrong', headingLevel, message, onRetry, retryLabel = 'Retry', retrying = false, size = 'section',
}: ErrorStateProps) {
  return (
    <div className={`state state-${size}`}>
      <span className="state-art state-art-error">
        <Icon name="error" />
      </span>
      <div role="alert" className="state-message">
        <StateTitle {...{ title, headingLevel }} />
        <div className="state-text">{message}</div>
      </div>
      <div className="state-action">
        <Button icon="refresh" loading={retrying} loadingLabel="Retrying" onClick={onRetry}>
          {retryLabel}
        </Button>
      </div>
    </div>
  )
}
