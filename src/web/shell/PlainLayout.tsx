import type { ReactNode } from 'react'
import { productName } from '../../shared/product'
import { BrandMark } from './BrandMark'
import { PageBoundary } from './PageBoundary'
import { mainId, SkipLink } from './SkipLink'
import { ThemeMenu } from './ThemeMenu'
import './shell.css'

/** For pages without navigation: signing in, and what clients see. */
export function PlainLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="plain">
      <SkipLink />
      <header className="plain-header">
        <span className="brand">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-name">{productName}</span>
            <span className="brand-owner">by JET Engineering</span>
          </span>
        </span>
        <ThemeMenu />
      </header>
      <main id={mainId} tabIndex={-1} className="plain-main">
        {children ?? <PageBoundary />}
      </main>
    </div>
  )
}
