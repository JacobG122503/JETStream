import type { ReactNode } from 'react'
import { PageHeader } from '../../ui'
import { useDocumentTitle } from '../../shell/useDocumentTitle'
import './auth.css'

/** A narrow page without navigation: signing in and everything around it. */
export function AuthPage({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  useDocumentTitle(title)
  return (
    <div className="auth-page">
      <PageHeader title={title} description={description} />
      {children}
    </div>
  )
}
