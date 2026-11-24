import type { ReactNode } from 'react'

interface SectionProps {
  id: string
  title: string
  children: ReactNode
}

export function Section({ id, title, children }: SectionProps) {
  return (
    <section id={id} className="gallery-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="gallery-section-title">
        {title}
      </h2>
      {children}
    </section>
  )
}

interface ExampleProps {
  title: string
  note?: ReactNode
  /** `row` puts small things next to each other, `grid` fields, `block` one thing. */
  layout?: 'row' | 'grid' | 'block'
  children: ReactNode
}

export function Example({ title, note, layout = 'row', children }: ExampleProps) {
  return (
    <div className="gallery-example">
      <h3 className="gallery-example-title">{title}</h3>
      {note && <p className="gallery-note">{note}</p>}
      <div className={`gallery-${layout}`}>{children}</div>
    </div>
  )
}
