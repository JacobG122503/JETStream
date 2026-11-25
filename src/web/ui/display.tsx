import { type ReactNode, useId, useState } from 'react'
import { classNames } from './classNames'
import { Icon, type IconName } from './Icon'
import './display.css'

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const toneIcons: Partial<Record<Tone, IconName>> = { success: 'success', warning: 'warning', danger: 'error', info: 'info' }

export interface BadgeProps {
  tone?: Tone
  children: ReactNode
}

/** A status in words. The colour and icon only support the text. */
export function Badge({ tone = 'neutral', children }: BadgeProps) {
  const icon = toneIcons[tone]
  return (
    <span className={`badge badge-${tone}`}>
      {icon && <Icon name={icon} />}
      <span className="badge-text">{children}</span>
    </span>
  )
}

export interface AvatarProps {
  name: string
  /** Address of a picture. Initials are shown without one, or when it cannot be loaded. */
  src?: string
  size?: 'small' | 'medium' | 'large'
  /** Set when the name is written next to it, so it is not read out twice. */
  decorative?: boolean
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0]]
  return letters.map((word) => [...(word ?? '?')][0]).join('').toUpperCase()
}

function avatarTone(name: string): number {
  let sum = 0
  for (const letter of name) sum += letter.codePointAt(0) ?? 0
  return (sum % 4) + 1
}

export function Avatar({ name, src, size = 'medium', decorative = false }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string>()
  const picture = src !== undefined && src !== failedSrc
  return (
    <span
      className={classNames('avatar', `avatar-${size}`, `avatar-tone-${avatarTone(name)}`)}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name, title: name })}
    >
      {picture ? <img src={src} alt="" onError={() => setFailedSrc(src)} /> : <span aria-hidden="true">{initials(name)}</span>}
    </span>
  )
}

export interface CardProps {
  title?: string
  /** Level of the title's heading, to fit the page's outline. */
  headingLevel?: 2 | 3 | 4
  actions?: ReactNode
  children: ReactNode
}

export function Card({ title, headingLevel = 2, actions, children }: CardProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-header">
          {title && <Heading className="card-title">{title}</Heading>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  )
}

export interface StatTileProps {
  label: string
  value: string
  /** What the number is of, or how it changed. */
  detail?: ReactNode
}

export function StatTile({ label, value, detail }: StatTileProps) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {detail && <div className="stat-detail">{detail}</div>}
    </div>
  )
}

export interface ProgressBarProps {
  label: string
  /** 0 to 100, or more for something that went over. */
  percent: number
  /** What the percentage is of, such as "108 of 80 hours". */
  detail?: string
  /** Word for more than 100 percent. */
  overLabel?: string
}

export function ProgressBar({ label, percent, detail, overLabel = 'Over budget' }: ProgressBarProps) {
  const labelId = useId()
  const rounded = Math.round(Math.max(0, percent))
  // A little over must not read as exactly 100%.
  const over = percent > 100
  const shown = over ? Math.max(101, rounded) : percent < 100 ? Math.min(99, rounded) : 100
  const state = over ? `${overLabel} by ${shown - 100}%` : null
  return (
    <div className={classNames('progress', over && 'is-over')}>
      <div className="progress-header">
        <span id={labelId} className="progress-label">
          {label}
        </span>
        <span className="progress-value">{shown}%</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(shown, 100)}
        aria-valuetext={[`${shown}%`, state, detail].filter(Boolean).join(', ')}
      >
        <div className="progress-fill" style={{ width: `${Math.min(shown, 100)}%` }} />
        {/* Where 100% was, on a track that stands for the whole amount. */}
        {over && <div className="progress-over" style={{ left: `${(100 / shown) * 100}%` }} />}
      </div>
      {(state || detail) && (
        <div className="progress-footer">
          {state && (
            <span className="progress-state">
              <Icon name="warning" />
              {state}
            </span>
          )}
          {detail && <span>{detail}</span>}
        </div>
      )}
    </div>
  )
}

export interface PageHeaderProps {
  title: string
  /** 1 on pages, through the Page component; lower when a header is part of a page. */
  headingLevel?: 1 | 2 | 3
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, headingLevel = 1, description, actions }: PageHeaderProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className="page-header">
      <div className="page-header-row">
        <div className="page-header-text">
          <Heading className="page-title" tabIndex={headingLevel === 1 ? -1 : undefined}>
            {title}
          </Heading>
          {description && <div className="page-description">{description}</div>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  )
}

export interface FilterBarProps {
  /** Accessible name, such as "Filter invoices". */
  label: string
  children: ReactNode
  /** Shown at the end, such as a button that clears the filters. */
  actions?: ReactNode
}

export function FilterBar({ label, children, actions }: FilterBarProps) {
  return (
    <div className="filter-bar" role="group" aria-label={label}>
      {children}
      {actions && <div className="filter-bar-actions">{actions}</div>}
    </div>
  )
}
