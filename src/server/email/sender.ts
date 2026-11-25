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
  /** What else it is about. */
  about?: { type: string; id: number }
}

export const linkPlaceholder = '{link}'

/** Sends email: see smtp.ts, or keeps it in the Outbox. */
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
      await db.insert(outboxMessages).values({ ...outboxValues(message), status: 'captured' })
    },
  }
}

export const hiddenLink = '[link hidden]'

/** What is kept of a message. */
export const outboxValues = (message: EmailMessage) => ({
  kind: message.kind,
  recipients: [message.to],
  subject: message.subject,
  body: messageText({ ...message, ...(message.link === undefined ? {} : { link: hiddenLink }) }),
  subjectType: message.about?.type ?? (message.personId === undefined ? null : 'person'),
  subjectId: message.about?.id ?? message.personId ?? null,
  createdBy: message.createdBy ?? null,
})

/** Sends after the change it tells about was saved, so a failure is logged and changes nothing else. */
export async function sendEmail(sender: EmailSender, message: EmailMessage): Promise<void> {
  try {
    await sender.send(message)
  } catch (error) {
    console.error(`An email (${message.kind}) could not be sent.\n${describeError(error)}`)
  }
}
