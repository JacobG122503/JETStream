import { randomBytes, scryptSync } from 'node:crypto'

/** A password hash as an earlier version, with cheaper parameters, might have stored it. */
export function hashOld(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, { N: 2 ** 10, r: 8, p: 1 })
  return Promise.resolve(`$scrypt$ln=10,r=8,p=1$${salt.toString('base64')}$${hash.toString('base64')}`)
}
