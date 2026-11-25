/** What clients see of an invoice through a link. */
import { and, eq, isNull } from 'drizzle-orm'
import type { ClientInvoice } from '../../shared/billing'
import { todayIn } from '../clock'
import type { AppContext } from '../context'
import type { Db } from '../db'
import { clients, files, invoiceAttachments, invoiceLinks, invoices } from '../db/schema'
import { NotFoundError } from '../errors'
import { linkInvalid } from '../people/links'
import { getSettings } from '../people/lookup'
import { linkHash } from './documents'
import { attachmentsOf, printInvoice } from './invoices'

async function byLink(db: Db, token: unknown) {
  const [row] = await db
    .select({ link: invoiceLinks, invoice: invoices, client: clients })
    .from(invoiceLinks)
    .innerJoin(invoices, eq(invoices.id, invoiceLinks.invoiceId))
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(eq(invoiceLinks.tokenHash, linkHash(token)), isNull(invoiceLinks.revokedAt)))
  if (!row || row.invoice.status === 'draft') throw linkInvalid()
  return row
}

export async function readClientInvoice(ctx: AppContext, token: unknown): Promise<ClientInvoice> {
  const { db } = ctx
  const { link, invoice, client } = await byLink(db, token)
  await db.update(invoiceLinks).set({ lastViewedAt: ctx.now() }).where(eq(invoiceLinks.id, link.id))
  const { status, dueOn, paidAmount, dueAmount } = invoice
  if (status === 'draft') throw linkInvalid()
  return {
    ...(await printInvoice(db, invoice, client)), status, dueOn, paidAmount, dueAmount, late: status === 'open' && dueOn < todayIn((await getSettings(db)).timeZone, ctx.now()),
    attachments: await attachmentsOf(db, invoice.id),
  }
}

export async function readClientFile(ctx: AppContext, token: unknown, fileId: number) {
  const { invoice } = await byLink(ctx.db, token)
  const [row] = await ctx.db
    .select({ file: files })
    .from(invoiceAttachments)
    .innerJoin(files, eq(files.id, invoiceAttachments.fileId))
    .where(and(eq(invoiceAttachments.invoiceId, invoice.id), eq(invoiceAttachments.fileId, fileId)))
  if (!row) throw new NotFoundError(fileId)
  return { name: row.file.name, mediaType: row.file.mediaType, content: row.file.content.toString('base64') }
}
