/** Limits on guessing and on floods. Attempts are kept in the database, so limits survive a restart. */
import { and, desc, eq, gt, lt, max, sql } from 'drizzle-orm'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx } from '../db'
import { signInAttempts } from '../db/schema'
import { ApiError } from '../errors'

const minute = 60_000
const hour = 60 * minute

interface Rule {
  /** What counts together; without both, all attempts of the kind would. */
  by: ('email' | 'address')[]
  limit: number
  windowMs: number
  /** A success starts the count afresh. */
  clearedBySuccess?: boolean
}

const rules = {
  sign_in: [
    { by: ['email', 'address'], limit: 5, windowMs: 15 * minute, clearedBySuccess: true },
    { by: ['address'], limit: 50, windowMs: 15 * minute },
    { by: ['email'], limit: 30, windowMs: hour },
  ],
  /** A signed-in person's current password. */
  password_check: [{ by: ['email'], limit: 5, windowMs: 15 * minute }],
  sign_up: [{ by: ['address'], limit: 20, windowMs: hour }],
  forgot_password: [{ by: ['address'], limit: 10, windowMs: hour }],
  /** Invite and reset links that do not work. */
  link: [{ by: ['address'], limit: 20, windowMs: 15 * minute }],
  /** Notices of the payment service that cannot be read. */
  payment_notice: [{ by: ['address'], limit: 100, windowMs: 15 * minute }],
} satisfies Record<string, Rule[]>

export type LimitKind = keyof typeof rules
const longestWindowMs = hour

interface Who {
  /** In lower case. */
  email?: string
  address?: string
}

export interface Attempt {
  /** The attempt turned out well and does not count. */
  succeeded: () => Promise<void>
}

/**
 * Counts an attempt before it is made, so that attempts at the same time cannot slip past the
 * limit together. Throws when there were too many; that itself is not counted.
 */
export async function takeAttempt(ctx: AppContext, kind: LimitKind, who: Who): Promise<Attempt> {
  const now = ctx.now()
  const email = (who.email ?? '').slice(0, 254)
  const address = who.address ?? ''
  const id = await runTransaction(ctx.db, async (tx) => {
    const list: Rule[] = rules[kind]
    const keys = list.map(({ by }) => [kind, ...by.map((part) => (part === 'email' ? `e ${email}` : `a ${address}`))].join('|'))
    // In a fixed order, so that two attempts cannot wait for each other.
    for (const key of keys.sort()) await lockKey(tx, key)
    let waitMs = 0
    for (const rule of list) waitMs = Math.max(waitMs, await waitFor(tx, kind, rule, { email, address }, now))
    if (waitMs > 0) throw tooManyAttempts(waitMs)
    const [row] = await tx
      .insert(signInAttempts)
      .values({ kind, email, address, succeeded: false, attemptedAt: now })
      .returning({ id: signInAttempts.id })
    return row?.id ?? 0
  })
  return {
    succeeded: async () => {
      await ctx.db.update(signInAttempts).set({ succeeded: true }).where(eq(signInAttempts.id, id))
    },
  }
}

/** Held until the transaction ends. Text keys of different uses must differ. */
export async function lockKey(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
}

/** How long until another attempt is allowed; 0 for now. */
async function waitFor(tx: Tx, kind: string, rule: Rule, who: Required<Who>, now: Date): Promise<number> {
  const same = and(
    eq(signInAttempts.kind, kind),
    ...rule.by.map((part) => eq(signInAttempts[part], who[part])),
    gt(signInAttempts.attemptedAt, new Date(now.getTime() - rule.windowMs)),
  )
  let since = 0
  if (rule.clearedBySuccess) {
    const [last] = await tx
      .select({ id: max(signInAttempts.id) })
      .from(signInAttempts)
      .where(and(same, eq(signInAttempts.succeeded, true)))
    since = last?.id ?? 0
  }
  // The one that has to grow old before there is room again.
  const [oldest] = await tx
    .select({ at: signInAttempts.attemptedAt })
    .from(signInAttempts)
    .where(and(same, eq(signInAttempts.succeeded, false), gt(signInAttempts.id, since)))
    .orderBy(desc(signInAttempts.attemptedAt), desc(signInAttempts.id))
    .limit(1)
    .offset(rule.limit - 1)
  return oldest ? oldest.at.getTime() + rule.windowMs - now.getTime() : 0
}

function tooManyAttempts(waitMs: number): ApiError {
  const retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000))
  return new ApiError(429, 'too_many_attempts', 'Too many attempts. Try again later.', { retryAfterSeconds })
}

/** How many attempts of the kind named this email in the last hour. */
export async function attemptsFor(ctx: AppContext, kind: LimitKind, email: string): Promise<number> {
  return ctx.db.$count(
    signInAttempts,
    and(
      eq(signInAttempts.kind, kind),
      eq(signInAttempts.email, email.slice(0, 254)),
      gt(signInAttempts.attemptedAt, new Date(ctx.now().getTime() - hour)),
    ),
  )
}

export async function removeOldAttempts(db: Db, now: Date): Promise<void> {
  await db.delete(signInAttempts).where(lt(signInAttempts.attemptedAt, new Date(now.getTime() - longestWindowMs)))
}

const queues = new Map<string, Promise<unknown>>()

/**
 * Runs work with the same key one after another. Not needed for the limits to hold, but without it
 * a person pressing twice would use up tries with the right password.
 */
export async function inTurn<T>(key: string, work: () => Promise<T>): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve()
  const mine = before.then(work, work)
  const settled = mine.catch(() => undefined)
  queues.set(key, settled)
  try {
    return await mine
  } finally {
    if (queues.get(key) === settled) queues.delete(key)
  }
}
