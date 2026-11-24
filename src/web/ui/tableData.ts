export type SortDirection = 'ascending' | 'descending'

export type SortValue = string | number | null | undefined

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

const isEmpty = (value: SortValue) => value === null || value === undefined || value === '' || Number.isNaN(value)

/** Numbers by size, text as people expect, empty values last both ways. Equal rows keep their order. */
export function sortRows<T>(rows: readonly T[], valueOf: (row: T) => SortValue, direction: SortDirection): T[] {
  const sign = direction === 'ascending' ? 1 : -1
  return [...rows].sort((rowA, rowB) => {
    const a = valueOf(rowA)
    const b = valueOf(rowB)
    if (isEmpty(a) || isEmpty(b)) return Number(isEmpty(a)) - Number(isEmpty(b))
    if (typeof a === 'number' && typeof b === 'number') return sign * (a - b)
    return sign * collator.compare(String(a), String(b))
  })
}

export interface PageOfRows<T> {
  rows: T[]
  /** From 1. */
  page: number
  pageCount: number
  /** "1-25 of 60" */
  summary: string
}

/** One page of rows; a page past the end gives the last one. */
export function pageOf<T>(rows: readonly T[], page: number, pageSize: number): PageOfRows<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  const begin = (current - 1) * pageSize
  const shown = rows.slice(begin, begin + pageSize)
  return {
    rows: shown,
    page: current,
    pageCount,
    summary: rows.length === 0 ? '0 of 0' : `${begin + 1}-${begin + shown.length} of ${rows.length}`,
  }
}
