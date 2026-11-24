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

function derive(password: string, salt: Buffer, { logN, r, p }: typeof cost, length: number): Promise<Buffer> {
  const options: ScryptOptions = { N: 2 ** logN, r, p, maxmem: memoryLimit }
  // The same characters can be typed in different encodings.
  const text = password.normalize('NFKC')
  return new Promise((resolve, reject) => {
    scrypt(text, salt, length, options, (error, hash) => (error ? reject(error) : resolve(hash)))
  })
}
