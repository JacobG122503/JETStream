/** What clients see of an invoice through a link, and paying it online. */
import { and, eq, isNull } from 'drizzle-orm'
import type { ClientInvoice } from '../../shared/billing'
import { recordPayment } from '../billing'
import { todayIn } from '../clock'
import type { AppContext } from '../context'
import type { Db } from '../db'
import { clients, files, invoiceAttachments, invoiceLinks, invoices, payments } from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { linkInvalid } from '../people/links'
import { getSettings } from '../people/lookup'
import { describeError } from '../errors'
import { BadSignatureError, type PaymentNotice } from '../payments/provider'
import { clientLink, linkHash } from './documents'
import { attachmentsOf, printInvoice } from './invoices'
import { tellPaid } from './invoiceWork'
import { notify } from './notify'
import { formatMoney } from './text'

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
    attachments: await attachmentsOf(db, invoice.id), online: status === 'open' && dueAmount > 0 ? (ctx.payments?.name ?? null) : null,
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

/** Pays all that is due: at once where it is simulated, or on the payment service's page. */
export async function payAsClient(ctx: AppContext, token: unknown): Promise<{ redirect: string } | { invoice: ClientInvoice }> {
  const { invoice, client } = await byLink(ctx.db, token)
  const { payments: provider } = ctx
  if (!provider || invoice.status !== 'open' || invoice.dueAmount <= 0) throw new ApiError(409, 'invoice_not_payable', 'This invoice cannot be paid here.')
  let started
  try {
    started = await provider.start({
      invoiceId: invoice.id, number: invoice.number, clientName: client.name, amount: invoice.dueAmount, currency: invoice.currency, returnUrl: clientLink(ctx, 'invoice', String(token)),
    })
  } catch (error) {
    console.error(`An online payment could not be started.\n${describeError(error)}`)
    throw new ApiError(502, 'payment_service', 'The payment service cannot be reached. Try again later.')
  }
  if (started.kind === 'redirect') return { redirect: started.url }
  const today = todayIn((await getSettings(ctx.db)).timeZone, ctx.now())
  const { invoice: paid } = await recordPayment(ctx.db, {
    invoiceId: invoice.id, amount: invoice.dueAmount, paidOn: today, method: 'online', provider: provider.name, providerReference: started.reference,
  })
  await tellPaid(ctx, paid, invoice.dueAmount, null)
  return { invoice: await readClientInvoice(ctx, token) }
}

/** A notice of the payment service. The same one again changes nothing. */
export async function takePaymentNotice(ctx: AppContext, body: Buffer, signature: string): Promise<void> {
  const { payments: provider } = ctx
  if (!provider?.readNotice) throw new ApiError(404, 'not_found', 'Not found')
  let notice: PaymentNotice | null
  try {
    notice = provider.readNotice(body, signature, ctx.now())
  } catch (error) {
    if (error instanceof BadSignatureError || error instanceof SyntaxError) throw new ApiError(400, 'bad_notice', 'The notice could not be read.')
    throw error
  }
  if (!notice) return
  const { invoiceId, amount, currency, reference } = notice
  const same = and(eq(payments.provider, provider.name), eq(payments.providerReference, reference))
  if ((await ctx.db.$count(payments, same)) > 0) return
  const [invoice] = await ctx.db.select().from(invoices).where(eq(invoices.id, invoiceId))
  if (!invoice) return
  const today = todayIn((await getSettings(ctx.db)).timeZone, ctx.now())
  const counted = invoice.currency === currency && invoice.status === 'open' ? Math.min(amount, invoice.dueAmount) : 0
  if (counted > 0) {
    const { invoice: paid } = await recordPayment(ctx.db, { invoiceId, amount: counted, paidOn: today, method: 'online', provider: provider.name, providerReference: reference })
    await tellPaid(ctx, paid, counted, null)
  }
  if (counted < amount) {
    // The money came, but there is nothing to count it on: someone has to look at it.
    await notify(ctx, [invoice.createdBy], {
      kind: 'invoice_paid', title: `More was paid than was due on invoice ${invoice.number}`, path: `/invoices/${invoiceId}`,
      body: `${formatMoney(amount, currency)} came in online (${reference}), of which ${formatMoney(counted, invoice.currency)} could be counted. Refund the rest at the payment service.`,
    })
  }
}
