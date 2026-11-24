import { type ChildProcess, spawn } from 'node:child_process'
import { createServer, type AddressInfo } from 'node:net'
import { projectRoot } from '../paths'

/** A port nothing listens on at the moment. */
export async function findFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

export interface ServerProcess {
  child: ChildProcess
  /** Everything printed so far. */
  output: () => string
  /** The address, once the server says it is running. Rejects if it exits first. */
  ready: Promise<string>
  /** The exit code, or null if it was killed by a signal. */
  exited: Promise<number | null>
  /** Sends a signal and waits for the exit code. */
  stop: (signal?: NodeJS.Signals) => Promise<number | null>
}

/**
 * Runs `node <args>` in the project folder. The environment's own server settings are not
 * passed on, so a DATABASE_URL on the developer's machine can never be touched by tests.
 * With `ownGroup`, `process.kill(-pid)` signals it and its children, as Ctrl+C in a terminal does.
 */
export function startServerProcess(args: string[], settings: Record<string, string> = {}, ownGroup = false): ServerProcess {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of ['DATABASE_URL', 'HOST', 'PORT', 'BASE_PATH', 'NODE_ENV', 'NODE_OPTIONS']) delete env[name]
  const child = spawn(process.execPath, args, { cwd: projectRoot, env: { ...env, ...settings }, detached: ownGroup })

  // So that nothing is left running if the test process exits early.
  const kill = () => child.kill('SIGKILL')
  process.once('exit', kill)

  let output = ''
  const exited = new Promise<number | null>((resolve) => {
    child.once('close', (code) => {
      process.off('exit', kill)
      resolve(code)
    })
  })
  const ready = new Promise<string>((resolve, reject) => {
    const collect = (chunk: Buffer) => {
      output += chunk.toString()
      const url = /is running at (\S+)\n/.exec(output)?.[1]
      if (url) resolve(url)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    void exited.then((code) => reject(new Error(`The server exited with code ${code}:\n${output}`)))
  })
  ready.catch(() => undefined) // Not every caller waits for it.

  return {
    child,
    output: () => output,
    ready,
    exited,
    stop: (signal = 'SIGTERM') => {
      child.kill(signal)
      return exited
    },
  }
}
