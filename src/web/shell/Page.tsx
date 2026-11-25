import type { ReactNode } from 'react'
import { PageHeader, type PageHeaderProps } from '../ui'
import { useDocumentTitle } from './useDocumentTitle'

interface PageProps extends Omit<PageHeaderProps, 'headingLevel'> {
  children: ReactNode
  /** For pages that begin with a picture: the title is there, but not seen. */
  hideTitle?: boolean
}

/** Every page: document title, the only h1, and the content. */
export function Page({ children, hideTitle = false, ...header }: PageProps) {
  useDocumentTitle(header.title)
  return (
    <div className="page">
      {hideTitle ? (
        <h1 className="page-title sr-only" tabIndex={-1}>
          {header.title}
        </h1>
      ) : (
        <PageHeader {...header} />
      )}
      {children}
    </div>
  )
}
