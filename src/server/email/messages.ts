/** The wording of the messages about accounts. */
import { productName } from '../../shared/product'
import { type EmailMessage, linkPlaceholder } from './sender'

type Text = Pick<EmailMessage, 'kind' | 'subject' | 'body'>

const text = (kind: string, subject: string, name: string, ...paragraphs: string[]): Text => ({
  kind,
  subject,
  body: [`Hello ${name},`, ...paragraphs, productName].join('\n\n'),
})

export const inviteText = (name: string, company: string, from: string) =>
  text(
    'invite', `${company}: your invitation to ${productName}`, name,
    `${from} invites you to ${productName} at ${company}. Set your password here:`, linkPlaceholder,
    'The link works once and for 7 days.',
  )

export const resetText = (name: string) =>
  text(
    'password_reset', `Set a new password for ${productName}`, name, 'You can set a new password here:', linkPlaceholder,
    'The link works once and for one hour. If you did not ask for it, tell your administrator.',
  )

export const approvedText = (name: string, company: string) =>
  text('sign_up_approved', `Your ${productName} account is ready`, name, `Your request to join ${company} was approved. You can sign in now.`)

export const declinedText = (name: string, company: string) =>
  text('sign_up_declined', `Your request to join ${productName}`, name, `Your request to join ${company} was declined.`)

export const passwordChangedText = (name: string) =>
  text(
    'password_changed', `Your ${productName} password was changed`, name, 'The password of your account was changed.',
    'If that was not you, tell your administrator at once.',
  )

export const signUpNoticeText = (name: string) =>
  text(
    'sign_up_notice', 'Someone tried to sign up with your address', name,
    `Someone asked for a ${productName} account with your email address, which already has an account or an invitation. Nothing was changed.`,
    'If that was you, sign in, use the link of your invitation, or choose "Forgot password".',
  )
