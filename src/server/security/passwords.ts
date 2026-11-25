/**
 * Password hashes with scrypt, a memory-hard function built into Node. The stored text names the
 * algorithm and its cost, so that the cost can be raised later:
 * $scrypt$ln=15,r=8,p=3$<salt>$<hash>
 */
import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from 'node:crypto'

const cost = { logN: 15, r: 8, p: 3 }
const saltBytes = 16
const hashBytes = 32
/** Above what the cost needs, and far below what a bad stored value could exhaust. */
const memoryLimit = 256 * 1024 * 1024

const format = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]+=*)\$([A-Za-z0-9+/]+=*)$/

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltBytes)
  const hash = await derive(password, salt, cost, hashBytes)
  const { logN, r, p } = cost
  return `$scrypt$ln=${logN},r=${r},p=${p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

/** False for a wrong password, and for a stored value that is not such a hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = format.exec(stored)
  if (!match) return false
  const [logN = 0, r = 0, p = 0] = match.slice(1, 4).map(Number)
  const [salt, expected] = match.slice(4).map((text) => Buffer.from(text, 'base64'))
  if (logN < 1 || r < 1 || p < 1 || !salt || !expected || expected.length < 16) return false
  const actual = await derive(password, salt, { logN, r, p }, expected.length)
  return timingSafeEqual(actual, expected)
}

/** Whether a stored hash was made with other parameters than new ones are. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`$scrypt$ln=${cost.logN},r=${cost.r},p=${cost.p}$`)
}

/** As slow as verifying a password, for when there is none to verify. */
export async function spendVerification(password: string): Promise<false> {
  await derive(password, randomBytes(saltBytes), cost, hashBytes)
  return false
}

async function derive(password: string, salt: Buffer, { logN, r, p }: typeof cost, length: number): Promise<Buffer> {
  const options: ScryptOptions = { N: 2 ** logN, r, p, maxmem: memoryLimit }
  // The same characters can be typed in different encodings.
  const text = password.normalize('NFKC')
  await takeTurn()
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(text, salt, length, options, (error, hash) => (error ? reject(error) : resolve(hash)))
    })
  } finally {
    endTurn()
  }
}

/**
 * Hashing runs on Node's few worker threads, which file and network name lookups need too. Only
 * some hash at a time, so that the rest of the server goes on and memory use stays small.
 */
const maxHashing = 2
let hashing = 0
const waiting: (() => void)[] = []

async function takeTurn() {
  if (hashing < maxHashing) hashing++
  else await new Promise<void>((resolve) => waiting.push(resolve))
}

function endTurn() {
  const next = waiting.shift()
  // The turn is handed on, so the count stays.
  if (next) next()
  else hashing--
}
