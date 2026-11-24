// One command for development: the API under `tsx watch` (restarts on change) and Vite (updates
// the browser on change), which passes API requests on.
import { spawn } from 'node:child_process'
import { createServer as createNetServer, type AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer, type ViteDevServer } from 'vite'
import { loadConfig } from '../src/server/config'
import { StartupError } from '../src/server/errors'
import { projectRoot } from '../src/server/paths'
import { checkPortIsFree, serverUrl } from '../src/server/server'

async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

function startApi(port: number, dataDir: string) {
  const tsx = createRequire(import.meta.url).resolve('tsx/cli')
  return spawn(
    process.execPath,
    [tsx, 'watch', '--clear-screen=false', '--include', 'drizzle/**/*', 'src/server/main.ts', '--dev', '--data-dir', dataDir],
    {
      cwd: projectRoot,
      // Ctrl+C reaches every process of the terminal's group. tsx watch takes that together with
      // the signal sent by stop() as a reason to kill the API before it has closed the database,
      // so it runs in a group of its own (on Windows that would open another window). Outside
      // the terminal's group it cannot read the keyboard.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    },
  )
}

async function waitForApi(url: string) {
  for (;;) {
    const response = await fetch(url).catch(() => undefined)
    if (response?.ok) return
    await delay(200)
  }
}

try {
  const config = loadConfig(['--dev', ...process.argv.slice(2)], process.env)
  await checkPortIsFree(config)
  if (process.env.DATABASE_URL) {
    console.log('DATABASE_URL is ignored: development uses the embedded database.')
  }

  const apiPort = await freePort()
  const api = startApi(apiPort, config.database.kind === 'embedded' ? config.database.dataDir : '')
  let vite: ViteDevServer | undefined = undefined
  let stopping = false
  const stop = async (exitCode: number) => {
    if (stopping) return
    stopping = true
    const apiExited = new Promise((resolve) => api.once('exit', resolve))
    if (api.exitCode === null && api.signalCode === null) {
      api.kill('SIGTERM')
      await apiExited
    }
    await vite?.close()
    process.exit(exitCode)
  }
  process.on('SIGINT', () => void stop(0))
  process.on('SIGHUP', () => void stop(0)) // The terminal was closed.
  process.on('exit', () => {
    if (!stopping) api.kill('SIGTERM') // Something went wrong here.
  })
  api.once('exit', (code) => void stop(code ?? 1))
  const onSigterm = () => void stop(0)
  process.on('SIGTERM', onSigterm)

  vite = await createServer({
    configFile: `${projectRoot}/vite.config.ts`,
    base: config.basePath,
    server: {
      host: config.host,
      port: config.port,
      strictPort: true,
      proxy: {
        [`^${config.basePath.replaceAll('.', '\\.')}api(?=[/?]|$)`]: `http://127.0.0.1:${apiPort}`,
      },
    },
  })
  // Vite would end this process on SIGTERM without waiting for the API; stop() closes Vite too.
  process.removeAllListeners('SIGTERM').on('SIGTERM', onSigterm)

  await vite.listen()
  await waitForApi(`http://127.0.0.1:${apiPort}${config.basePath}api/health`)
  console.log(`\nJET Time (development) is running at ${serverUrl(config)}\n`)
} catch (error) {
  console.error(error instanceof StartupError ? `JET Time: ${error.message}` : error)
  process.exit(1)
}
