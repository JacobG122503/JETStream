import { BrandMark } from './BrandMark'
import { PageBoundary } from './PageBoundary'
import { mainId, SkipLink } from './SkipLink'
import { ThemeMenu } from './ThemeMenu'
import './shell.css'

/** For pages without navigation: signing in, and what clients see. */
export function PlainLayout() {
  return (
    <div className="plain">
      <SkipLink />
      <header className="plain-header">
        <span className="brand">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-name">JET Time</span>
            <span className="brand-owner">by JET Engineering</span>
          </span>
        </span>
        <ThemeMenu />
      </header>
      <main id={mainId} tabIndex={-1} className="plain-main">
        <PageBoundary />
      </main>
    </div>
  )
}
