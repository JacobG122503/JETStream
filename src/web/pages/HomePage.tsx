import { ServerStatus } from '../ServerStatus'

export function HomePage() {
  return (
    <main>
      <h1>JET Time</h1>
      <p>Time tracking, expenses and client billing for JET Engineering.</p>
      <ServerStatus />
    </main>
  )
}
