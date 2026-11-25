import type { ReactNode } from 'react'
import { productName } from '../../shared/product'
import { BrandMark } from './BrandMark'
import { PageBoundary } from './PageBoundary'
import { mainId, SkipLink } from './SkipLink'
import { StreamLines } from './StreamLines'
import { ThemeMenu } from './ThemeMenu'
import './shell.css'

const weekShape = ['62%', '88%', '74%', '100%', '55%']

/** For pages without navigation: signing in, and what clients see. */
export function PlainLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="plain">
      <SkipLink />
      <div className="plain-art" aria-hidden="true">
        <StreamLines className="plain-art-lines" count={22} width={800} height={900} />
        <div className="plain-art-cards">
          <div className="glass">
            <strong>Your week</strong>
            <div className="glass-bars">
              {weekShape.map((height, day) => (
                <span key={day} style={{ height }} />
              ))}
            </div>
          </div>
          <div className="glass">
            <strong>Your budget</strong>
            <svg className="glass-ring" viewBox="0 0 80 80" focusable="false">
              <circle cx="40" cy="40" r="32" />
              <circle cx="40" cy="40" r="32" pathLength="100" strokeDasharray="68 100" />
            </svg>
          </div>
        </div>
        <div className="plain-art-text">
          <p className="plain-art-title">Every hour, on course.</p>
          <p className="plain-art-lead">Track the work, watch the budget and bill the client, all in one current.</p>
        </div>
      </div>
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
