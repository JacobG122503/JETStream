/** Reports someone saved for themselves: where they are, with what was chosen. */
import { and, asc, eq } from 'drizzle-orm'
import type { SavedReport } from '../../shared/work'
import type { Actor } from '../access/actor'
import { ownId } from '../access/decisions'
import { invalidInput } from '../api/input'
import type { Db } from '../db'
import { savedReports } from '../db/schema'
import { ApiError, NotFoundError } from '../errors'

/** A page of this app's reports with plain choices, and nothing else. */
const reportPath = /^\/reports(?:\/(detailed|expenses|profitability|contractors|invoices|payments))?(?:\?[\w.~%+=&-]*)?$/
const mostReports = 100

export async function listSavedReports(db: Db, actor: Actor): Promise<SavedReport[]> {
  const rows = await db.select().from(savedReports).where(eq(savedReports.ownerId, ownId(actor))).orderBy(asc(savedReports.name), asc(savedReports.id))
  return rows.flatMap(({ id, name, definition: { path }, createdAt }) => (typeof path === 'string' && reportPath.test(path) ? [{ id, name, path, createdAt: createdAt.toISOString() }] : []))
}

export async function saveReport(db: Db, actor: Actor, { name, path }: { name: string; path: string }): Promise<void> {
  const ownerId = ownId(actor)
  const match = reportPath.exec(path)
  if (!match) throw invalidInput({ path: 'This report cannot be saved.' })
  if ((await db.$count(savedReports, eq(savedReports.ownerId, ownerId))) >= mostReports) throw new ApiError(409, 'too_many', `At most ${mostReports} reports can be saved. Delete some first.`)
  await db.insert(savedReports).values({ ownerId, name, kind: match[1] ?? 'time', definition: { path } })
}

export async function deleteSavedReport(db: Db, actor: Actor, id: number): Promise<void> {
  const gone = await db.delete(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.ownerId, ownId(actor)))).returning({ id: savedReports.id })
  if (gone.length === 0) throw new NotFoundError(id)
}
