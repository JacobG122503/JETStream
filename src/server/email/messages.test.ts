import { expect, it } from 'vitest'
import { approvedText, declinedText, inviteText, passwordChangedText, resetText, signUpNoticeText } from './messages'

// The name is spelled out, so that a misspelled constant fails.
it.each([
  [inviteText('Ada', 'JET Engineering', 'Avery'), 'JET Engineering: your invitation to JETStream', 'Avery invites you to JETStream at JET Engineering.'],
  [resetText('Ada'), 'Set a new password for JETStream', 'You can set a new password here:'],
  [approvedText('Ada', 'JET Engineering'), 'Your JETStream account is ready', 'Your request to join JET Engineering was approved.'],
  [declinedText('Ada', 'JET Engineering'), 'Your request to join JETStream', 'Your request to join JET Engineering was declined.'],
  [passwordChangedText('Ada'), 'Your JETStream password was changed', 'The password of your account was changed.'],
  [signUpNoticeText('Ada'), 'Someone tried to sign up with your address', 'Someone asked for a JETStream account with your email address'],
])('$kind names the product', (message, subject, sentence) => {
  expect(message.subject).toBe(subject)
  expect(message.body).toContain(sentence)
  expect(message.body).toMatch(/^Hello Ada,\n\n[^]*\n\nJETStream$/)
})
