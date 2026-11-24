import { useEffect, useRef } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { ErrorBoundary, ErrorState, PageHeader } from '../ui'
import { focusPageHeading } from '../ui/overlay/focus'
import { useDocumentTitle } from './useDocumentTitle'

/** The current page. An error while it renders is shown in its place, and gone on the next page. */
export function PageBoundary() {
  const location = useLocation()
  const page = useOutlet()
  return (
    <ErrorBoundary resetKey={location.key} fallback={(retry) => <PageError onRetry={retry} />}>
      {page}
    </ErrorBoundary>
  )
}

function PageError({ onRetry }: { onRetry: () => void }) {
  useDocumentTitle('Something went wrong')
  useEffect(() => {
    // The control that had focus may be gone with the page.
    if (document.activeElement === null || document.activeElement === document.body) focusPageHeading()
  }, [])
  // After a retry, whichever heading is there.
  const retried = useRef(false)
  useEffect(
    () => () => {
      if (retried.current) setTimeout(focusPageHeading)
    },
    [],
  )
  return (
    <>
      <PageHeader title="Something went wrong" />
      <ErrorState
        size="page"
        headingLevel={2}
        title="This page could not be shown"
        message="Try again, or choose another page. If it keeps happening, reload the app."
        retryLabel="Try again"
        onRetry={() => {
          retried.current = true
          onRetry()
        }}
      />
    </>
  )
}
