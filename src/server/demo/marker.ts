import { eq } from 'drizzle-orm'
import type { IsoDate } from '../../shared/dates'
import type { Db } from '../db'
import { appMeta } from '../db/schema'

/** Key of the demo marker in app_meta. Its value is the date the data was made for. */
export const markerKey = 'demo_seed'

/** The date the demo data was made for, or null when the database does not hold demo data. */
export async function demoSeedDate(db: Db): Promise<IsoDate | null> {
  const [row] = await db.select().from(appMeta).where(eq(appMeta.key, markerKey))
  return row?.value ?? null
}
