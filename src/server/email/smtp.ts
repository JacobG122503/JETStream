/** Email over the company's own mail server. Every message is also kept in the Outbox. */
import { and, eq, lt, notLike } from 'drizzle-orm'
import { createTransport } from 'nodemailer'
import type { Db } from '../db'
import { outboxMessages } from '../db/schema'
import { describeError } from '../errors'
import { isLoopback, type SmtpConfig } from '../config'
import { type EmailSender, hiddenLink, messageText, outboxValues } from './sender'

interface Mail {
  from: string
  to: { name: string; address: string }
  subject: string
  text: string
}

export interface SmtpSender extends EmailSender {
  /** Sends what could not be sent before, up to some attempts. */
  retry: () => Promise<number>
}

const mostAttempts = 5
/** Sends nothing that a template or a person could turn into a file or an address to fetch. */
const safety = { disableFileAccess: true, disableUrlAccess: true } as const
/** Never the server's answer as a whole: it may hold addresses and more. */
const shortError = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error').replace(/\s+/g, ' ').slice(0, 200)

export function smtpSender(db: Db, { url, from }: SmtpConfig, deliver?: (mail: Mail) => Promise<unknown>): SmtpSender {
  const { hostname, protocol } = new URL(url)
  const transport = createTransport(url, { ...safety, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 })
  // Passwords never travel unprotected, except on this computer.
  if (protocol === 'smtp:' && !isLoopback(hostname)) Object.assign(transport.options, { requireTLS: true })
  const send = deliver ?? ((mail: Mail) => transport.sendMail({ ...mail, ...safety }))
  const attempt = async (id: number, attempts: number, mail: Mail) => {
    try {
      await send(mail)
      await db.update(outboxMessages).set({ status: 'sent', sentAt: new Date(), error: null, attempts }).where(eq(outboxMessages.id, id))
      return true
    } catch (error) {
      console.error(`An email could not be sent.\n${describeError(error)}`)
      await db.update(outboxMessages).set({ status: 'failed', error: shortError(error), attempts }).where(eq(outboxMessages.id, id))
      return false
    }
  }
  return {
    delivers: true,
    send: async (message) => {
      const [row] = await db.insert(outboxMessages).values({ ...outboxValues(message), status: 'queued' }).returning({ id: outboxMessages.id })
      if (row) await attempt(row.id, 1, { from, to: { name: message.to.name, address: message.to.email }, subject: message.subject, text: messageText(message) })
    },
    retry: async () => {
      // Links are not kept, so a message with one cannot be sent again.
      const failed = await db
        .select()
        .from(outboxMessages)
        .where(and(eq(outboxMessages.status, 'failed'), lt(outboxMessages.attempts, mostAttempts), notLike(outboxMessages.body, `%${hiddenLink}%`)))
        .limit(50)
      let sent = 0
      for (const { id, attempts, recipients, subject, body } of failed) {
        const [to] = recipients
        if (to && (await attempt(id, attempts + 1, { from, to: { name: to.name, address: to.email }, subject, text: body }))) sent++
      }
      return sent
    },
  }
}
