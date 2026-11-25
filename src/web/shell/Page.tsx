import type { ReactNode } from 'react'
import { PageHeader, type PageHeaderProps } from '../ui'
import { useDocumentTitle } from './useDocumentTitle'

interface PageProps extends Omit<PageHeaderProps, 'headingLevel'> {
  children: ReactNode
}

/** Every page: document title, the only h1, and the content. */
export function Page({ children, ...header }: PageProps) {
  useDocumentTitle(header.title)
  return (
    <div className="page">
      <PageHeader {...header} />
      {children}
    </div>
  )
}
