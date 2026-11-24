import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>There is no page at this address.</p>
      <Link to="/">Go to the home page</Link>
    </main>
  )
}
