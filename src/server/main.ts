import { loadConfig } from './config'
import { StartupError } from './errors'
import { type RunningServer, startServer } from './server'

const shutdownLimitMs = 4500

function fail(error: unknown): never {
  console.error(error instanceof StartupError ? `JET Time: ${error.message}` : error)
  process.exit(1)
}

// Signals are handled from the start, so that stopping during startup still closes the database.
let starting: Promise<RunningServer> | undefined
let stopping = false

function stop() {
  if (stopping) return
  stopping = true
  setTimeout(() => {
    console.error('JET Time: did not stop in time, exiting.')
    process.exit(1)
  }, shutdownLimitMs).unref()
  void (async () => {
    try {
      const server = await starting
      await server?.close()
      process.exit(0)
    } catch (error) {
      fail(error)
    }
  })()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

try {
  const config = loadConfig(process.argv.slice(2), process.env)
  // Libraries look at NODE_ENV; the mode decides it, so it cannot be forgotten.
  process.env.NODE_ENV = config.mode === 'development' ? 'development' : 'production'
  starting = startServer(config)
  const { url } = await starting
  // In development people use the Vite address, which scripts/dev.ts prints.
  if (config.mode === 'demo') {
    const { database } = config
    const where = database.kind === 'embedded' ? database.dataDir : ''
    console.log(`DEMO MODE: for showing JET Time on this computer only. Data is kept in ${where}`)
  }
  console.log(config.mode === 'development' ? 'API ready' : `JET Time is running at ${url}`)
} catch (error) {
  fail(error)
}
