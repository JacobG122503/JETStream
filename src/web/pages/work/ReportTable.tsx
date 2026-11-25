import { type ReactNode, useState } from 'react'
import { Icon } from '../../ui'

export interface ReportColumn<T> {
  id: string
  header: string
  /** Without one, the column cannot be sorted by. */
  value?: (row: T) => string | number
  cell: (row: T) => ReactNode
  numeric?: boolean
  /** A bar, which has no heading. */
  bar?: boolean
  total?: ReactNode
}

interface ReportTableProps<T extends { id: number }> {
  label: string
  columns: ReportColumn<T>[]
  rows: T[]
  totalLabel?: string
}

/** The figures of a report. The first column names the row. */
export function ReportTable<T extends { id: number }>({ label, columns, rows, totalLabel = 'Total' }: ReportTableProps<T>) {
  const [sort, setSort] = useState<{ id: string; down: boolean }>({ id: columns[0]?.id ?? '', down: false })
  if (rows.length === 0) return <div className="day-empty">There is nothing in this period.</div>
  const by = columns.find(({ id }) => id === sort.id)?.value
  const sorted = by
    ? [...rows].sort((a, b) => {
        const [x, y] = [by(a), by(b)]
        return (typeof x === 'string' ? x.localeCompare(String(y)) : x - Number(y)) * (sort.down ? -1 : 1)
      })
    : rows
  const choose = ({ id, numeric }: ReportColumn<T>) => setSort((before) => ({ id, down: before.id === id ? !before.down : Boolean(numeric) }))
  return (
    <div className="table-scroll team-scroll" tabIndex={0} role="region" aria-label={label}>
      <table className="report-table">
        <thead>
          <tr>
            {columns.map((column) =>
              column.bar ? (
                <td key={column.id} />
              ) : (
                <th key={column.id} scope="col" className={column.numeric ? 'is-numeric' : undefined} aria-sort={sort.id === column.id ? (sort.down ? 'descending' : 'ascending') : undefined}>
                  {column.value ? (
                    <button type="button" className="report-sort" onClick={() => choose(column)}>
                      {column.header}
                      {sort.id === column.id && <Icon name={sort.down ? 'arrowUp' : 'arrowDown'} />}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id}>
              {columns.map((column, index) =>
                index === 0 ? (
                  <th key={column.id} scope="row">
                    {column.cell(row)}
                  </th>
                ) : (
                  <td key={column.id} className={column.bar ? 'report-cell-bar' : column.numeric ? 'is-numeric' : undefined}>
                    {column.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            {columns.map((column, index) =>
              index === 0 ? (
                <th key={column.id} scope="row">
                  {totalLabel}
                </th>
              ) : (
                <td key={column.id} className={column.numeric ? 'is-numeric' : undefined}>
                  {column.total}
                </td>
              ),
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
