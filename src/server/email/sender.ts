import type { Db } from '../db'
import { outboxMessages } from '../db/schema'
import { describeError } from '../errors'

export interface EmailMessage {
  kind: string
  to: { name: string; email: string }
  subject: string
  /** Where the link goes, the body says `linkPlaceholder`. */
  body: string
  link?: string
  /** The person it is about. */
  personId?: number
  createdBy?: number
}

export const linkPlaceholder = '{link}'

/** Sends email. 018 adds one for SMTP. */
export interface EmailSender {
  /** Whether messages reach people. */
  delivers: boolean
  send: (message: EmailMessage) => Promise<void>
}

export function messageText({ body, link }: EmailMessage): string {
  return link === undefined ? body : body.replaceAll(linkPlaceholder, () => link)
}

/** Keeps messages in the Outbox and sends nothing. Links are left out: they work like passwords. */
export function captureSender(db: Db): EmailSender {
  return {
    delivers: false,
    send: async (message) => {
      await db.insert(outboxMessages).values({
        kind: message.kind,
        status: 'captured',
        recipients: [message.to],
        subject: message.subject,
        body: messageText({ ...message, ...(message.link === undefined ? {} : { link: '[link hidden]' }) }),
        subjectType: message.personId === undefined ? null : 'person',
        subjectId: message.personId ?? null,
        createdBy: message.createdBy ?? null,
      })
    },
  }
}

/** Sends after the change it tells about was saved, so a failure is logged and changes nothing else. */
export async function sendEmail(sender: EmailSender, message: EmailMessage): Promise<void> {
  try {
    await sender.send(message)
  } catch (error) {
    console.error(`An email (${message.kind}) could not be sent.\n${describeError(error)}`)
  }
}
