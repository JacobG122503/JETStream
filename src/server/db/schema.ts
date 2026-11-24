import { pgTable, text } from 'drizzle-orm/pg-core'

/** Facts about this installation, one row each. */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
