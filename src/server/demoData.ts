// npm run db:seed, db:reset and demo:reset: adds demo data, or erases it and adds it afresh.
import { createInterface } from 'node:readline/promises'
import { openDatabase } from './db'
import { applyMigrations } from './db/migrations'
import { checkResetAllowed, checkSeedAllowed, demoAccountLines, resetDemo, seedDemo } from './demo'
import { type DemoCommand, parseDemoCommand } from './demo/guard'
import { StartupError } from './errors'

async function confirm({ name, confirmed }: DemoCommand) {
  if (confirmed) return
  if (!process.stdin.isTTY) {
    throw new StartupError(`This erases the database "${name}". Run it in a terminal to confirm, or add -- --yes.`)
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log(`This erases everything in the database "${name}" and fills it with demo data.`)
    // Ctrl+D or Ctrl+C closes the question without an answer.
    const closed = new Promise<string>((resolve) => terminal.once('close', () => resolve('')))
    const answer = await Promise.race([terminal.question(`Type ${name} to go on: `), closed])
    if (answer.trim() !== name) throw new StartupError('Not confirmed. Nothing was changed.')
  } finally {
    terminal.close()
  }
}

async function run(command: DemoCommand) {
  const { action, database: config, name, today } = command
  if (action === 'reset') await confirm(command)
  const database = await openDatabase(config, { lockWaitMs: 500 })
  try {
    // Before migrating, so that a refused database is left as it is. Checked again when writing.
    await (action === 'seed' ? checkSeedAllowed : checkResetAllowed)(database.db)
    await applyMigrations(database)
    const date = await (action === 'seed' ? seedDemo : resetDemo)(database.db, { today })
    console.log(`Filled the database "${name}" with demo data for ${date}.`)
    for (const line of demoAccountLines()) console.log(line)
  } finally {
    await database.close()
  }
}

try {
  await run(parseDemoCommand(process.argv.slice(2), process.env))
} catch (error) {
  console.error(error instanceof StartupError ? `JET Time: ${error.message}` : error)
  process.exitCode = 1
}
