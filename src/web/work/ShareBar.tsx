/** Billable and other hours as one bar. The figures are next to it. */
export function ShareBar({ billable, minutes, most }: { billable: number; minutes: number; most: number }) {
  const part = (value: number) => `${most === 0 ? 0 : (value / most) * 100}%`
  return (
    <span className="share-bar" aria-hidden="true">
      <span className="key-billable" style={{ width: part(billable) }} />
      <span className="key-other" style={{ width: part(minutes - billable) }} />
    </span>
  )
}
