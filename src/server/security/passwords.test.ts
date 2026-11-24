import { expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './passwords'

it('verifies the right password only', async () => {
  const hash = await hashPassword('correct horse')
  expect(hash).toMatch(/^\$scrypt\$ln=15,r=8,p=3\$[\w+/=]{24}\$[\w+/=]{44}$/)
  expect(hash).not.toContain('correct')
  expect(await verifyPassword('correct horse', hash)).toBe(true)
  expect(await verifyPassword('Correct horse', hash)).toBe(false)
  expect(await verifyPassword('', hash)).toBe(false)
})

it('salts every hash', async () => {
  expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
})

it('takes encodings of a character as equal', async () => {
  expect(await verifyPassword('café', await hashPassword('café'))).toBe(true)
})

it.each(['', 'x', '$scrypt$', '$scrypt$ln=0,r=8,p=1$AAAA$AAAA', '$scrypt$ln=4,r=8,p=1$AAAA$AAAA', '$argon2id$v=19$m=1,t=1,p=1$AAAA$AAAA'])(
  'is false for a stored value it does not know: %s',
  async (stored) => expect(await verifyPassword('x', stored)).toBe(false),
)
