import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import './Notice.css'

export interface NoticeProps {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  title?: string
  children: ReactNode
  /** Buttons that go with it. */
  action?: ReactNode
  /** Announces it when it appears: at once, or when there is time. */
  announce?: 'alert' | 'status'
}

const icons: Record<NonNullable<NoticeProps['tone']>, IconName> = {
  info: 'info', success: 'success', warning: 'warning', danger: 'error',
}

/** Something to know about the page or form it is in. */
export function Notice({ tone = 'info', title, children, action, announce }: NoticeProps) {
  return (
    <div className={`notice notice-${tone}`}>
      <Icon name={icons[tone]} />
      <div className="notice-body">
        <div role={announce}>
          {title && <p className="notice-title">{title}</p>}
          <div>{children}</div>
        </div>
        {action && <div className="notice-action">{action}</div>}
      </div>
    </div>
  )
}
