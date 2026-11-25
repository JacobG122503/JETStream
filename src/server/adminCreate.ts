// npm run admin:create: the first administrator, or a new password for one (--reset <email>).
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { isEmail, nameLength, normalizeEmail, passwordLength } from '../shared/accounts'
import { productName } from '../shared/product'
import { type DatabaseConfig, defaultDataDir, parseDatabaseUrl } from './config'
import { type Db, openDatabase } from './db'
import { countPendingMigrations } from './db/migrations'
import { captureSender } from './email/sender'
import { describeError, StartupError } from './errors'
import {
  checkCanCreate, checkEmailIsFree, createAdministrator, findAdministrator, resetAdministrator,
} from './people/firstAdministrator'
import { passwordProblem } from './security/passwordPolicy'

const usage =
  'Usage: npm run admin:create [-- --name <name> --email <email> --password-stdin] or npm run admin:create -- --reset <email> [--password-stdin]'

interface Options {
  name?: string
  email?: string
  reset?: string
  passwordStdin: boolean
  dataDir?: string
}

function parseOptions(args: string[]): Options {
  let values
  try {
    ;({ values } = parseArgs({
      args,
      options: {
        name: { type: 'string' },
        email: { type: 'string' },
        reset: { type: 'string' },
        'password-stdin': { type: 'boolean', default: false },
        'data-dir': { type: 'string' },
      },
    }))
  } catch {
    // Not the reason itself: it repeats what was typed, which could be a password.
    throw new StartupError(`An option is not known or has no value. A password cannot be given as an option. ${usage}`)
  }
  if (values.reset !== undefined && (values.name !== undefined || values.email !== undefined)) {
    throw new StartupError(`--reset takes the email itself, without --name and --email. ${usage}`)
  }
  return {
    name: values.name,
    email: values.email,
    reset: values.reset,
    passwordStdin: values['password-stdin'] ?? false,
    dataDir: values['data-dir'],
  }
}

function target(dataDir: string | undefined): DatabaseConfig {
  const url = parseDatabaseUrl(process.env)
  if (url) {
    if (dataDir !== undefined) throw new StartupError('--data-dir cannot be used with DATABASE_URL.')
    return { kind: 'postgres', url }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new StartupError('DATABASE_URL is required in production. Set it to your PostgreSQL server.')
  }
  return { kind: 'embedded', dataDir: dataDir ?? defaultDataDir('development') }
}

/** Asks in the terminal. What is typed for a hidden question is not shown. */
function ask(question: string, hidden = false): Promise<string> {
  let silent = false
  const output = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      if (!silent) process.stdout.write(chunk)
      done()
    },
  })
  const terminal = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 })
  return new Promise((resolve, reject) => {
    // Ctrl+C or Ctrl+D; after an answer it changes nothing any more.
    terminal.once('close', () => reject(new StartupError('Stopped. Nothing was changed.')))
    terminal.question(question, (answer) => {
      if (hidden) process.stdout.write('\n')
      resolve(answer)
      terminal.close()
    })
    silent = hidden
  })
}

const needTerminal = (option: string) =>
  new StartupError(`There is no terminal to ask in, so ${option} is needed. ${usage}`)

async function readPipe(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
}

async function readPassword({ passwordStdin }: Options, email: string): Promise<string> {
  let password: string
  if (passwordStdin) {
    password = await readPipe()
  } else {
    password = await ask(`Password (${passwordLength.min} to ${passwordLength.max} characters): `, true)
    const problem = passwordProblem(password, email)
    if (problem !== null) throw new StartupError(problem)
    if ((await ask('Password again: ', true)) !== password) throw new StartupError('The two passwords differ. Nothing was changed.')
  }
  const problem = passwordProblem(password, email)
  if (problem !== null) throw new StartupError(problem)
  return password
}

function checkEmail(text: string): string {
  const email = normalizeEmail(text)
  if (!isEmail(email)) throw new StartupError('This is not an email address such as name@example.com.')
  return email
}

function checkName(text: string): string {
  const name = text.trim()
  const { length } = [...name]
  if (length < nameLength.min || length > nameLength.max || /\p{Cc}/u.test(name)) {
    throw new StartupError(`The name must have ${nameLength.min} to ${nameLength.max} characters.`)
  }
  return name
}

/** Before the database is opened: what is missing and cannot be asked for. */
function checkInput({ name, email, reset, passwordStdin }: Options) {
  const terminal = process.stdin.isTTY
  if (passwordStdin && terminal) throw new StartupError('--password-stdin reads the password from a pipe, not from the terminal.')
  if (terminal) return
  if (reset === undefined && name === undefined) throw needTerminal('--name')
  if (reset === undefined && email === undefined) throw needTerminal('--email')
  if (!passwordStdin) throw needTerminal('--password-stdin')
}

async function run(db: Db, options: Options) {
  if (options.reset !== undefined) {
    const email = checkEmail(options.reset)
    const { name } = await findAdministrator(db, email)
    await resetAdministrator(db, captureSender(db), email, await readPassword(options, email))
    console.log(`${name} can sign in with the new password. All their sessions were ended.`)
    return
  }
  await checkCanCreate(db)
  const name = checkName(options.name ?? (await ask('Name: ')))
  const email = checkEmail(options.email ?? (await ask('Email: ')))
  await checkEmailIsFree(db, email)
  await createAdministrator(db, { name, email, password: await readPassword(options, email) })
  console.log(`${name} (${email}) is an administrator and can sign in.`)
}

try {
  const options = parseOptions(process.argv.slice(2))
  const config = target(options.dataDir)
  checkInput(options)
  const database = await openDatabase(config, { lockWaitMs: 500 })
  try {
    const pending = await countPendingMigrations(database.db)
    if (pending > 0) {
      throw new StartupError(`The database is missing ${pending} migration(s). Run npm run db:migrate first.`)
    }
    await run(database.db, options)
  } finally {
    await database.close()
  }
} catch (error) {
  console.error(error instanceof StartupError ? `${productName}: ${error.message}` : `The command failed.\n${describeError(error)}`)
  process.exitCode = 1
}
