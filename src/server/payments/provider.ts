/** How clients pay online: simulated, or through Stripe's own payment page. Card data never comes here. */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export interface OnlinePayment {
  invoiceId: number
  number: string
  clientName: string
  amount: number
  currency: string
  /** Where the client comes back to. */
  returnUrl: string
}

/** Paid at once, or somewhere to send the client to. */
export type PaymentStart = { kind: 'paid'; reference: string } | { kind: 'redirect'; url: string }

export interface PaymentNotice {
  invoiceId: number
  amount: number
  currency: string
  reference: string
}

export interface PaymentProvider {
  name: 'simulated' | 'stripe'
  start: (payment: OnlinePayment) => Promise<PaymentStart>
  /** Reads a signed notice of the service: a payment, or null for anything else. Throws for a wrong signature. */
  readNotice?: (body: Buffer, signature: string, now: Date) => PaymentNotice | null
}

/** Takes no money, and says so wherever it is offered. Never used in production. */
export const simulatedPayments: PaymentProvider = {
  name: 'simulated',
  start: () => Promise.resolve({ kind: 'paid', reference: `sim-${randomUUID()}` }),
}

export interface StripeSettings {
  secretKey: string
  webhookSecret: string
  /** Set by tests. */
  apiUrl?: string
}

export class BadSignatureError extends Error {}

const oldestNoticeSeconds = 300

/** Stripe Checkout. Written against Stripe's documentation; try it with test keys before going live. */
export function stripePayments({ secretKey, webhookSecret, apiUrl = 'https://api.stripe.com' }: StripeSettings): PaymentProvider {
  return {
    name: 'stripe',
    start: async ({ invoiceId, number, clientName, amount, currency, returnUrl }) => {
      const fields = new URLSearchParams({
        mode: 'payment', success_url: returnUrl, cancel_url: returnUrl, 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(amount), 'line_items[0][price_data][product_data][name]': `Invoice ${number}`,
        'metadata[invoice]': String(invoiceId), 'metadata[client]': clientName.slice(0, 200),
      })
      const response = await fetch(`${apiUrl}/v1/checkout/sessions`, {
        method: 'POST', body: fields, headers: { Authorization: `Bearer ${secretKey}`, 'Idempotency-Key': randomUUID() }, signal: AbortSignal.timeout(15_000),
      })
      const answer = (await response.json().catch(() => null)) as { url?: unknown } | null
      if (!response.ok || typeof answer?.url !== 'string' || !answer.url.startsWith('https://')) throw new Error(`The payment service answered ${response.status}.`)
      return { kind: 'redirect', url: answer.url }
    },
    readNotice: (body, signature, now) => {
      const parts = signature.split(',').map((part) => part.split('=') as [string, string | undefined])
      const time = parts.find(([key]) => key === 't')?.[1] ?? ''
      const expected = createHmac('sha256', webhookSecret).update(`${time}.`).update(body).digest()
      const matches = parts.some(([key, value]) => {
        if (key !== 'v1' || value === undefined || !/^[0-9a-f]{64}$/.test(value)) return false
        return timingSafeEqual(Buffer.from(value, 'hex'), expected)
      })
      if (!matches || Math.abs(now.getTime() / 1000 - Number(time)) > oldestNoticeSeconds) throw new BadSignatureError('The signature is wrong.')
      const event = JSON.parse(body.toString('utf8')) as {
        type?: string
        data?: { object?: { id?: string; payment_status?: string; amount_total?: number; currency?: string; metadata?: { invoice?: string } } }
      }
      const session = event.data?.object
      if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return null
      const invoiceId = Number(session?.metadata?.invoice)
      if (session?.payment_status !== 'paid' || !session.id || !Number.isInteger(invoiceId) || !Number.isInteger(session.amount_total)) return null
      return { invoiceId, amount: session.amount_total ?? 0, currency: (session.currency ?? '').toUpperCase(), reference: session.id }
    },
  }
}
