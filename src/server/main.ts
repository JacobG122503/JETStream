import { loadConfig } from './config'
import { StartupError } from './errors'
import { type RunningServer, startServer, StoppedError } from './server'

const shutdownLimitMs = 4500

function fail(error: unknown): never {
  console.error(error instanceof StartupError ? `JET Time: ${error.message}` : error)
  process.exit(1)
}

// Signals are handled from the start, so that stopping during startup still closes the database.
let starting: Promise<RunningServer> | undefined
let stopping = false
const stopped = new AbortController()

function stop() {
  if (stopping) return
  stopping = true
  stopped.abort()
  setTimeout(() => {
    console.error('JET Time: did not stop in time, exiting.')
    process.exit(1)
  }, shutdownLimitMs).unref()
  void (async () => {
    try {
      const server = await starting
      await server?.close()
    } catch (error) {
      if (!(error instanceof StoppedError)) fail(error)
    }
    process.exit(0)
  })()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

try {
  const config = loadConfig(process.argv.slice(2), process.env)
  // Libraries look at NODE_ENV; the mode decides it, so it cannot be forgotten.
  process.env.NODE_ENV = config.mode === 'development' ? 'development' : 'production'
  starting = startServer(config, stopped.signal)
  const { url, messages } = await starting
  // In development people use the Vite address, which scripts/dev.ts prints.
  if (config.mode === 'demo') {
    const { database } = config
    const where = database.kind === 'embedded' ? database.dataDir : ''
    console.log(`DEMO MODE: for showing JET Time on this computer only. Data is kept in ${where}`)
  }
  for (const message of messages) console.log(message)
  console.log(config.mode === 'development' ? 'API ready' : `JET Time is running at ${url}`)
} catch (error) {
  if (!(error instanceof StoppedError)) fail(error) // Otherwise stop() ends the process.
}
