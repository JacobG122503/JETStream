export const mainId = 'main'

/**
 * Focuses the main area without following the link, so the address (path, query and fragment)
 * stays as it is.
 */
export function SkipLink() {
  return (
    <a
      href={`#${mainId}`}
      className="skip-link"
      onClick={(event) => {
        event.preventDefault()
        document.getElementById(mainId)?.focus()
      }}
    >
      Skip to main content
    </a>
  )
}
