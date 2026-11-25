import { expect, it } from 'vitest'
import { commonPasswords } from './commonPasswords'
import { passwordProblem } from './passwordPolicy'

const email = 'alexandria@jet.example'

it.each([
  'short', '123456789', 'x'.repeat(129), 'aaaaaaaaaaaa', 'AaAaAaAaAaAa', '            ', 'jetdemo123', 'JetDemo123', 'password123',
  'Password123', '1234567890', 'qwertyuiop', email, 'Alexandria@JET.example', 'ALEXANDRIA', 'ａａａａａａａａａａ', 'ｐassword123',
])('refuses %s', (password) => {
  expect(passwordProblem(password, email)).toEqual(expect.any(String))
})

it.each(['ten chars!', 'x'.repeat(127) + 'y', 'correct horse battery', 'ünïcödé pässwörd', '🚲🚲🚲🚲🚲🚲🚲🚲🚲🚗', ' spaces around '])('accepts %s', (password) => {
  expect(passwordProblem(password, email)).toBeNull()
})

it('counts characters after normalisation', () => {
  // One letter each, however it was typed.
  expect(passwordProblem('éèêëú', email)).toContain('at least 10')
  // A single character that stands for several.
  expect(passwordProblem('ﷺabc', email)).toBeNull()
  expect(passwordProblem('ﷺ'.repeat(8) + 'x', email)).toContain('at most 128')
})

it('has a list of passwords that are long enough to matter', () => {
  for (const password of commonPasswords) {
    expect(password).toBe(password.toLowerCase())
    expect(password.length).toBeGreaterThanOrEqual(10)
  }
  expect(commonPasswords.size).toBeGreaterThan(900)
})
