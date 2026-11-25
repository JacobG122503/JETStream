/** The company's settings. */
import { eq } from 'drizzle-orm'
import type { CompanySettings, CompanySettingsInput } from '../../shared/work'
import type { Actor } from '../access/actor'
import { requirePermission } from '../access/decisions'
import { invalidInput } from '../api/input'
import type { AppContext } from '../context'
import { type Db, runTransaction, updateVersioned } from '../db'
import { clients, companySettings, files, personRates, tasks } from '../db/schema'
import { ApiError } from '../errors'
import { cleanImage, ImageError } from '../people/image'
import { getSettings } from '../people/lookup'
import { differences, logChange } from './common'

export async function readSettings(db: Db, actor: Actor): Promise<CompanySettings> {
  requirePermission(actor, 'settings.manage', 'all')
  const { id: _id, createdAt: _created, updatedAt: _updated, signUpEnabled: _signUp, ...settings } = await getSettings(db)
  return settings as CompanySettings
}

export async function saveSettings(ctx: AppContext, actor: Actor, { version, ...input }: CompanySettingsInput & { version: number }): Promise<void> {
  requirePermission(actor, 'settings.manage', 'all')
  if ((input.paymentTerms === 'custom') !== (input.paymentTermDays !== null)) throw invalidInput({ paymentTermDays: 'Enter the days for custom terms.' })
  await runTransaction(ctx.db, async (tx) => {
    const before = await getSettings(tx)
    if (input.currency !== before.currency) {
      // Stored rates name no currency: they would change their meaning.
      const used = (await tx.$count(personRates)) + (await tx.$count(clients)) + (await tx.$count(tasks))
      if (used > 0) throw new ApiError(409, 'currency_locked', 'The currency cannot be changed once there are clients, tasks or rates.')
    }
    await updateVersioned(tx, companySettings, 1, version, input)
    const changes = differences(before, input as unknown as Record<string, unknown>)
    if (Object.keys(changes).length > 0) await logChange(tx, actor, { action: 'updated', type: 'settings', id: 1, summary: 'Changed the company settings', changes })
  })
}

/** Makes the picture the company's logo, or takes it away. */
export async function saveLogo(ctx: AppContext, actor: Actor, upload: Buffer | null): Promise<void> {
  requirePermission(actor, 'settings.manage', 'all')
  let image: ReturnType<typeof cleanImage> | null = null
  try {
    image = upload && cleanImage(upload)
  } catch (error) {
    if (error instanceof ImageError) throw new ApiError(400, 'bad_image', error.message)
    throw error
  }
  await runTransaction(ctx.db, async (tx) => {
    const { logoFileId } = await getSettings(tx)
    const [file] = image
      ? await tx.insert(files).values({ name: 'logo', mediaType: image.mediaType, sizeBytes: image.content.length, content: image.content }).returning({ id: files.id })
      : []
    await tx.update(companySettings).set({ logoFileId: file?.id ?? null }).where(eq(companySettings.id, 1))
    if (logoFileId !== null) await tx.delete(files).where(eq(files.id, logoFileId))
    await logChange(tx, actor, { action: 'updated', type: 'settings', id: 1, summary: image ? 'Changed the logo' : 'Removed the logo' })
  })
}

/** The logo is on what clients see, so anyone may load it. */
export async function readLogo(db: Db): Promise<{ mediaType: string; content: Buffer }> {
  const { logoFileId } = await getSettings(db)
  const [file] = logoFileId === null ? [] : await db.select().from(files).where(eq(files.id, logoFileId))
  if (!file) throw new ApiError(404, 'not_found', 'Not found')
  return file
}
