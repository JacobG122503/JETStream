import { integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { importStatuses } from '../../../shared/domain'
import { createdAt, id, indexes, instant, notNegative, oneOf } from './columns'
import { files, people } from './people'

/** One imported file. Time entries point back to theirs. */
export const importBatches = pgTable(
  'import_batches',
  {
    id: id(),
    /** What was imported, such as clients, time or calendar (021). */
    kind: text('kind').notNull(),
    fileName: text('file_name').notNull().default(''),
    fileId: integer('file_id').references(() => files.id),
    status: text('status', { enum: importStatuses }).notNull(),
    rowCount: integer('row_count').notNull().default(0),
    problems: jsonb('problems').$type<unknown[]>().notNull().default([]),
    createdBy: integer('created_by')
      .notNull()
      .references(() => people.id),
    createdAt: createdAt(),
    completedAt: instant('completed_at'),
  },
  (t) => [oneOf(t.status, importStatuses), ...notNegative(t.rowCount), ...indexes(t.fileId, t.createdBy)],
)
