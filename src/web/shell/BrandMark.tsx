/** A J riding on currents of air: the same drawing as public/favicon.svg, in the brand token's colour. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="brand-mark-ground" width="32" height="32" rx="10" />
      <g className="brand-mark-ink" fill="none" strokeLinecap="round">
        <path d="M22 7.5v10.75a6 6 0 0 1-11.6 2.1" strokeWidth="3.5" />
        <path d="M8.5 8.5h8M5.5 13h11M9 17.4h7.5" strokeWidth="2" />
      </g>
    </svg>
  )
}
