import { type AnyColumn, type SQL, sql } from 'drizzle-orm'
import { fromDatabaseInteger } from './numbers'

/**
 * The sum of an integer or money column, 0 when there are no rows. Use it instead of Drizzle's
 * sum(): the drivers return sums differently, and one too large to be exact must be an error.
 */
export function sumExact(expression: AnyColumn | SQL): SQL<number> {
  return sql`coalesce(sum(${expression}), 0)`.mapWith(fromDatabaseInteger)
}
