export function AccessSummary({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section className="access-summary">
      <h3>{title}</h3>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
}
