// Builds, then runs the production build in demo mode in this same process, so that stopping
// the command stops the server.
import { spawnSync } from 'node:child_process'

const build = spawnSync('npm run build', { shell: true, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)

process.argv.push('--demo')
await import('../dist/server/main.js')
