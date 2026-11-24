/** A J beside a scale: the same drawing as public/favicon.svg, in the brand token's colour. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="brand-mark-ground" width="32" height="32" rx="7" />
      <g className="brand-mark-ink" fill="none" strokeLinecap="square">
        <path d="M14 7.5v11a4.75 4.75 0 0 1-8 3.45" strokeWidth="3.5" />
        <path d="M20 7.5h6M20 12.2h3M20 16.9h6M20 21.6h3" strokeWidth="2" />
      </g>
    </svg>
  )
}
