import { describe, expect, it } from 'vitest'
import { pageOf, sortRows } from './tableData'

const values = (list: (string | number | null | undefined)[], direction: 'ascending' | 'descending') =>
  sortRows(list.map((value) => ({ value })), (row) => row.value, direction).map((row) => row.value)

describe('sortRows', () => {
  it('sorts numbers by size with empty values last both ways', () => {
    expect(values([2, 10, 9, null], 'ascending')).toEqual([2, 9, 10, null])
    expect(values([2, 10, 9, null], 'descending')).toEqual([10, 9, 2, null])
    expect(values([undefined, 1, '', NaN, 0], 'descending').slice(0, 2)).toEqual([1, 0])
    expect(values([0, -1, 1], 'ascending')).toEqual([-1, 0, 1])
  })

  it('sorts text ignoring case, with numbers inside text by size', () => {
    expect(values(['b', 'A', 'c', ''], 'ascending')).toEqual(['A', 'b', 'c', ''])
    expect(values(['Line 10', 'line 9'], 'ascending')).toEqual(['line 9', 'Line 10'])
  })

  it('keeps the order of equal rows both ways and leaves the input alone', () => {
    const rows = [
      { id: 1, group: 'x' },
      { id: 2, group: 'y' },
      { id: 3, group: 'x' },
      { id: 4, group: null },
      { id: 5, group: null },
    ]
    expect(sortRows(rows, (row) => row.group, 'ascending').map((row) => row.id)).toEqual([1, 3, 2, 4, 5])
    expect(sortRows(rows, (row) => row.group, 'descending').map((row) => row.id)).toEqual([2, 1, 3, 4, 5])
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('pageOf', () => {
  const rows = Array.from({ length: 60 }, (_, index) => index + 1)

  it('gives a page and says which rows it has', () => {
    expect(pageOf(rows, 1, 25)).toMatchObject({ page: 1, pageCount: 3, summary: '1-25 of 60' })
    expect(pageOf(rows, 3, 25)).toMatchObject({ page: 3, summary: '51-60 of 60' })
    expect(pageOf(rows, 3, 25).rows).toEqual(rows.slice(50))
  })

  it('stays inside the pages there are', () => {
    expect(pageOf(rows, 9, 25).page).toBe(3)
    expect(pageOf(rows, 0, 25).page).toBe(1)
    expect(pageOf([], 1, 25)).toEqual({ rows: [], page: 1, pageCount: 1, summary: '0 of 0' })
  })
})
