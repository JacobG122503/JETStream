/** People's working details and rates, and archiving them. */
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { PersonInput, PersonWork } from '../../shared/work'
import type { IsoDate } from '../../shared/dates'
import { type Actor, readPersonAccess } from '../access/actor'
import { can, forbidden, holds, requirePermission, requireRecord } from '../access/decisions'
import { checkOutranks, keepAnAdministrator, lockForAccessChange, requireOutranks } from '../access/grants'
import { invalidInput } from '../api/input'
import { endSessions } from '../auth/sessions'
import type { AppContext } from '../context'
import { type Db, runTransaction, type Tx, updateVersioned } from '../db'
import { helpRequests, invites, labels, passwordResets, people, personLabels, personRates, timeEntries } from '../db/schema'
import { ApiError, NotFoundError } from '../errors'
import { hasOpenInvite } from '../people/invites'
import { builtInRole, findPersonByEmail, getSettings, lockEmail } from '../people/lookup'
import { addAssignments } from '../people/assignments'
import { differences, logChange, namedIds } from './common'
import { stoppedMinutes, todayOf } from './time'

export const rateKindsOf = (actor: Actor, personId: number) =>
  (['billable', 'cost'] as const).filter((kind) => can(actor, `${kind}.view`, { type: 'person', personId }))

const mayEdit = (actor: Actor, kind: 'billable' | 'cost') => holds(actor, `${kind}.edit`, 'all')

export async function readPersonWork(db: Db, actor: Actor, id: number): Promise<PersonWork> {
  requireRecord(actor, { view: 'people.view' }, { type: 'person', personId: id }, id)
  const [person] = await db.select().from(people).where(eq(people.id, id))
  const access = await readPersonAccess(db, id)
  if (!person || !access) throw new NotFoundError(id)
  const canManage = holds(actor, 'people.manage', 'all')
  const kinds = rateKindsOf(actor, id)
  const own = await db.select({ name: labels.name }).from(personLabels).innerJoin(labels, eq(labels.id, personLabels.labelId)).where(eq(personLabels.personId, id)).orderBy(asc(labels.name))
  const rates = kinds.length === 0 ? [] : await db.select().from(personRates).where(and(eq(personRates.personId, id), inArray(personRates.kind, kinds))).orderBy(asc(personRates.startsOn))
  return {
    version: person.version, name: person.name, email: person.email, phone: person.phone, kind: person.kind, status: person.status,
    weeklyCapacityMinutes: person.weeklyCapacityMinutes, startedOn: person.startedOn, notes: canManage ? person.notes : null,
    department: person.department,
    labels: own.map(({ name }) => name),
    knownDepartments: canManage ? await listDepartments(db) : [],
    canManage,
    refusal: canManage ? (checkOutranks(actor, access)?.message ?? (actor.kind === 'person' && actor.id === id ? 'You cannot archive or delete yourself.' : null)) : 'You do not have access to this',
    knownLabels: canManage ? (await db.select({ name: labels.name }).from(labels).orderBy(asc(labels.name))).map(({ name }) => name) : [],
    currency: (await getSettings(db)).currency,
    rates: rates.map(({ id: rateId, version, kind, startsOn, rate }) => ({ id: rateId, version, kind, startsOn, rate })),
    mayEditRates: { billable: mayEdit(actor, 'billable'), cost: mayEdit(actor, 'cost') },
  }
}

/** The departments in use. */
export async function listDepartments(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ name: people.department }).from(people).where(ne(people.department, '')).orderBy(asc(people.department))
  return rows.map(({ name }) => name)
}

async function saveLabels(tx: Tx, personId: number, names: string[]): Promise<void> {
  const ids = await namedIds(tx, labels, names)
  await tx.delete(personLabels).where(eq(personLabels.personId, personId))
  if (ids.length > 0) await tx.insert(personLabels).values(ids.map((labelId) => ({ personId, labelId })))
}

async function checkEmail(tx: Tx, ctx: AppContext, email: string, exceptId = 0): Promise<void> {
  await lockEmail(tx, email)
  const found = await findPersonByEmail(tx, email)
  if (found && found.person.id !== exceptId) {
    const why = { active: 'This address is already used.', pending: 'This address is waiting for approval.', archived: 'This address belongs to an archived person.' }
    throw invalidInput({ email: why[found.person.status] })
  }
  if (!found && (await hasOpenInvite(tx, email, ctx.now()))) throw invalidInput({ email: 'This address already has an open invite.' })
}

export interface NewPersonInput extends PersonInput {
  clientIds: number[]
  projectIds: number[]
}

/** Adds a Member without a password. An invite, or a role, comes after that. */
export async function createPerson(ctx: AppContext, actor: Actor, { labels: names, clientIds, projectIds, ...input }: NewPersonInput): Promise<number> {
  requirePermission(actor, 'people.manage', 'all')
  return runTransaction(ctx.db, async (tx) => {
    await checkEmail(tx, ctx, input.email)
    const role = await builtInRole(tx, 'member')
    const [person] = await tx.insert(people).values({ ...input, status: 'active', roleId: role.id }).returning({ id: people.id })
    if (!person) throw new Error('The person was not stored.')
    await saveLabels(tx, person.id, names)
    const editor = await lockForAccessChange(tx, actor, { people: [person.id] })
    const target = await readPersonAccess(tx, person.id)
    if (target) await addAssignments(tx, editor, target, { clientIds, projectIds })
    await logChange(tx, actor, { action: 'created', type: 'person', id: person.id, summary: `Added ${input.name}` })
    return person.id
  })
}

export async function updatePerson(ctx: AppContext, actor: Actor, id: number, { version, labels: names, ...input }: PersonInput & { version: number }): Promise<void> {
  requirePermission(actor, 'people.manage', 'all')
  await runTransaction(ctx.db, async (tx) => {
    const editor = await lockForAccessChange(tx, actor, { people: [id] })
    const [before] = await tx.select().from(people).where(eq(people.id, id))
    const target = await readPersonAccess(tx, id)
    if (!before || !target) throw new NotFoundError(id)
    if (before.status === 'archived') throw new ApiError(409, 'not_active', 'This person is archived. Restore them first.')
    if (input.email.toLowerCase() !== before.email.toLowerCase()) {
      // Whoever changes the address can take the account over.
      requireOutranks(editor, target)
      if (editor.kind === 'person' && editor.id === id) throw new ApiError(403, 'own_access', 'Someone else has to change your email address.')
      await checkEmail(tx, ctx, input.email, id)
      await tx.update(invites).set({ endedAt: ctx.now() }).where(and(eq(invites.personId, id), sql`${invites.acceptedAt} is null and ${invites.endedAt} is null`))
      await tx.delete(passwordResets).where(eq(passwordResets.personId, id))
    }
    await updateVersioned(tx, people, id, version, input)
    await saveLabels(tx, id, names)
    const { notes: _notes, ...shown } = input
    await logChange(tx, actor, { action: 'updated', type: 'person', id, summary: `Changed ${input.name}`, changes: differences(before, shown) })
  })
}

export async function archivePerson(ctx: AppContext, actor: Actor, id: number, archive: boolean): Promise<void> {
  requirePermission(actor, 'people.manage', 'all')
  const now = ctx.now()
  await runTransaction(ctx.db, async (tx) => {
    const editor = await lockForAccessChange(tx, actor, { people: [id] })
    const [person] = await tx.select().from(people).where(eq(people.id, id)).for('update')
    const target = await readPersonAccess(tx, id)
    if (!person || !target) throw new NotFoundError(id)
    if (editor.kind === 'person' && editor.id === id) throw new ApiError(409, 'own_account', 'You cannot archive yourself.')
    requireOutranks(editor, target)
    if (person.status === 'pending') throw new ApiError(409, 'not_active', 'This person is waiting for approval. Decline the request instead.')
    if ((person.status === 'archived') === archive) return
    if (archive) {
      if (target.administrator) await keepAnAdministrator(tx, id)
      await endSessions(tx, id)
      await tx.delete(passwordResets).where(eq(passwordResets.personId, id))
      await tx.update(invites).set({ endedAt: now }).where(and(eq(invites.personId, id), sql`${invites.acceptedAt} is null and ${invites.endedAt} is null`))
      await tx.update(helpRequests).set({ closedAt: now }).where(and(eq(helpRequests.personId, id), isNull(helpRequests.closedAt)))
      const [running] = await tx.select().from(timeEntries).where(and(eq(timeEntries.personId, id), isNotNull(timeEntries.timerStartedAt))).for('update')
      if (running?.timerStartedAt) {
        await tx.update(timeEntries).set({ minutes: stoppedMinutes(running.minutes, running.timerStartedAt, now), timerStartedAt: null }).where(eq(timeEntries.id, running.id))
      }
    }
    await tx.update(people).set({ status: archive ? 'archived' : 'active', archivedOn: archive ? await todayOf(tx, id, now) : null }).where(eq(people.id, id))
    await logChange(tx, actor, { action: archive ? 'archived' : 'restored', type: 'person', id, summary: `${archive ? 'Archived' : 'Restored'} ${person.name}` })
  })
}

/** Only someone nothing was ever recorded for. */
export async function deletePerson(ctx: AppContext, actor: Actor, id: number): Promise<void> {
  requirePermission(actor, 'people.manage', 'all')
  try {
    await runTransaction(ctx.db, async (tx) => {
      const editor = await lockForAccessChange(tx, actor, { people: [id] })
      const target = await readPersonAccess(tx, id)
      if (!target) throw new NotFoundError(id)
      if (editor.kind === 'person' && editor.id === id) throw new ApiError(409, 'own_account', 'You cannot delete yourself.')
      requireOutranks(editor, target)
      if (target.administrator) await keepAnAdministrator(tx, id)
      await tx.update(people).set({ photoFileId: null }).where(eq(people.id, id))
      await tx.execute(sql`delete from files where owner_id = ${id} and media_type like 'image/%' and not exists (select 1 from expense_receipts where file_id = files.id)`)
      await tx.execute(sql`delete from project_members where person_id = ${id} and not exists (select 1 from time_entries t where t.person_id = ${id})`)
      await tx.delete(people).where(eq(people.id, id))
      await logChange(tx, actor, { action: 'deleted', type: 'person', id, summary: `Deleted ${target.person.name}` })
    })
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === '23503' || (error as { code?: string }).code === '23503') {
      throw new ApiError(409, 'person_in_use', 'There are records of this person, such as time. Archive them instead.')
    }
    throw error
  }
}

export interface RateInput {
  kind: 'billable' | 'cost'
  startsOn: IsoDate
  rate: number
}

export async function saveRate(ctx: AppContext, actor: Actor, personId: number, rateId: number | null, { version, ...input }: RateInput & { version: number | null }): Promise<void> {
  requireRecord(actor, { view: 'people.view' }, { type: 'person', personId }, personId)
  if (!mayEdit(actor, input.kind)) throw forbidden()
  await runTransaction(ctx.db, async (tx) => {
    const [person] = await tx.select().from(people).where(eq(people.id, personId)).for('update')
    if (!person) throw new NotFoundError(personId)
    const same = await tx
      .select({ id: personRates.id })
      .from(personRates)
      .where(and(eq(personRates.personId, personId), eq(personRates.kind, input.kind), eq(personRates.startsOn, input.startsOn), ne(personRates.id, rateId ?? 0)))
    if (same.length > 0) throw invalidInput({ startsOn: 'There is already a rate from this date.' })
    if (rateId === null) await tx.insert(personRates).values({ personId, ...input })
    else {
      const [found] = await tx.select().from(personRates).where(and(eq(personRates.id, rateId), eq(personRates.personId, personId), eq(personRates.kind, input.kind)))
      if (!found) throw new NotFoundError(rateId)
      await updateVersioned(tx, personRates, rateId, version ?? 0, { startsOn: input.startsOn, rate: input.rate })
    }
    await logChange(tx, actor, {
      action: 'rate_changed', type: 'person', id: personId, summary: `Changed a ${input.kind} rate of ${person.name}`, changes: { [`${input.kind}Rate`]: [null, input.rate], startsOn: [null, input.startsOn] },
    })
  })
}

export async function deleteRate(ctx: AppContext, actor: Actor, personId: number, rateId: number): Promise<void> {
  requireRecord(actor, { view: 'people.view' }, { type: 'person', personId }, personId)
  await runTransaction(ctx.db, async (tx) => {
    const [person] = await tx.select().from(people).where(eq(people.id, personId)).for('update')
    const [found] = await tx.select().from(personRates).where(and(eq(personRates.id, rateId), eq(personRates.personId, personId)))
    if (!person || !found) throw new NotFoundError(rateId)
    if (!mayEdit(actor, found.kind)) throw forbidden()
    await tx.delete(personRates).where(eq(personRates.id, rateId))
    await logChange(tx, actor, { action: 'rate_changed', type: 'person', id: personId, summary: `Deleted a ${found.kind} rate of ${person.name}`, changes: { [`${found.kind}Rate`]: [found.rate, null] } })
  })
}
