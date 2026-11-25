/** What people do with their own account. */
import { and, desc, eq } from 'drizzle-orm'
import type { Account, SignedInDevice } from '../../shared/api'
import { type CurrentSession, isOver } from '../auth/sessions'
import { type Db, runTransaction, updateVersioned } from '../db'
import { files, people, roles, sessions } from '../db/schema'
import { ApiError } from '../errors'
import { cleanImage, ImageError } from './image'
import { getSettings, lockPerson } from './lookup'
import { describeUserAgent } from './userAgent'

export async function readAccount(db: Db, personId: number): Promise<Account> {
  const [row] = await db
    .select({ person: people, role: roles.name })
    .from(people)
    .innerJoin(roles, eq(roles.id, people.roleId))
    .where(eq(people.id, personId))
  if (!row) throw new ApiError(404, 'not_found', 'Not found')
  const { person, role } = row
  return {
    name: person.name,
    email: person.email,
    role,
    timeZone: person.timeZone ?? (await getSettings(db)).timeZone,
    photoId: person.photoFileId,
    version: person.version,
  }
}

export async function saveProfile(
  db: Db, personId: number, { version, ...values }: { name: string; timeZone: string; version: number },
): Promise<void> {
  await updateVersioned(db, people, personId, version, values)
}

/** Makes the file the person's photo, if it is a picture, and drops the old one. */
export async function savePhoto(db: Db, personId: number, upload: Buffer): Promise<void> {
  let image: ReturnType<typeof cleanImage>
  try {
    image = cleanImage(upload)
  } catch (error) {
    if (error instanceof ImageError) throw new ApiError(400, 'bad_image', error.message)
    throw error
  }
  const { mediaType, content } = image
  await runTransaction(db, async (tx) => {
    const person = await lockPerson(tx, personId)
    const name = mediaType === 'image/png' ? 'photo.png' : 'photo.jpg'
    const [file] = await tx
      .insert(files)
      .values({ name, mediaType, content, sizeBytes: content.length, ownerId: personId })
      .returning({ id: files.id })
    await tx.update(people).set({ photoFileId: file?.id ?? null }).where(eq(people.id, personId))
    if (person?.photoFileId) await tx.delete(files).where(eq(files.id, person.photoFileId))
  })
}

export async function removePhoto(db: Db, personId: number): Promise<void> {
  await runTransaction(db, async (tx) => {
    const person = await lockPerson(tx, personId)
    if (!person?.photoFileId) return
    await tx.update(people).set({ photoFileId: null }).where(eq(people.id, personId))
    await tx.delete(files).where(eq(files.id, person.photoFileId))
  })
}

/** A file only if it is someone's current photo, and a picture. */
export async function readPhoto(db: Db, fileId: number): Promise<{ mediaType: string; content: Buffer }> {
  const [file] = await db
    .select({ mediaType: files.mediaType, content: files.content })
    .from(files)
    .innerJoin(people, eq(people.photoFileId, files.id))
    .where(eq(files.id, fileId))
    .limit(1)
  if (!file || (file.mediaType !== 'image/png' && file.mediaType !== 'image/jpeg')) {
    throw new ApiError(404, 'not_found', 'Not found')
  }
  return file
}

export async function listDevices(db: Db, session: CurrentSession, now: Date): Promise<SignedInDevice[]> {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.personId, session.person.id))
    .orderBy(desc(sessions.lastUsedAt), desc(sessions.id))
  return rows
    .filter((row) => !isOver(row, now))
    .map((row) => ({
      id: row.id,
      ...describeUserAgent(row.userAgent),
      signedInAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      current: row.id === session.id,
    }))
}

/** Ends one of the person's own sessions. Someone else's is not found. */
export async function endDevice(db: Db, personId: number, sessionId: number): Promise<void> {
  const ended = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.personId, personId)))
    .returning({ id: sessions.id })
  if (ended.length === 0) throw new ApiError(404, 'not_found', 'Not found')
}
