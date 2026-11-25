import { Link } from 'react-router-dom'

/** The parts of a section, above its content. */
export function SubNav({ label, current, items }: { label: string; current: string; items: { to: string; label: string }[] }) {
  return (
    <nav aria-label={label} className="sub-nav">
      {items.map((item) => (
        <Link key={item.to} to={item.to} aria-current={item.to === current ? 'page' : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
