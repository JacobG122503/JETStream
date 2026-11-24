import { type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { announce } from './announce'
import { Button, IconButton } from './Button'
import { classNames } from './classNames'
import { Checkbox, Select } from './fields'
import { Icon } from './Icon'
import { EmptyState, type EmptyStateProps, ErrorState, Skeleton } from './states'
import { pageOf, type SortDirection, sortRows, type SortValue } from './tableData'
import { narrowQuery, useMediaQuery } from './useMediaQuery'
import './Table.css'

export interface TableColumn<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  /** Makes the column sortable by this value. */
  sortValue?: (row: T) => SortValue
  /** Aligns to the right, with digits in columns. */
  numeric?: boolean
  /** Keeps each value on one line. For dates and other values that are always short. */
  nowrap?: boolean
  /** Cell of the totals row. */
  total?: ReactNode
}

export interface TableSort {
  columnId: string
  direction: SortDirection
}

export interface TableProps<T> {
  /** Says what the table holds. Always there for screen readers. */
  caption: string
  hideCaption?: boolean
  columns: TableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Names a row for screen readers, in the names of its checkbox and actions. */
  rowLabel: (row: T) => string
  status?: 'ready' | 'loading' | 'error'
  empty?: Omit<EmptyStateProps, 'size' | 'headingLevel'>
  error?: string
  onRetry?: () => void
  defaultSort?: TableSort
  pageSize?: number
  /** Keys of the selected rows. Turns on selection. */
  selected?: ReadonlySet<string>
  onSelectedChange?: (selected: Set<string>) => void
  /** Buttons or a menu for one row. */
  rowActions?: (row: T) => ReactNode
  /** Below 640px: rows become blocks, or the table scrolls sideways. */
  narrow?: 'stack' | 'scroll'
}

const skeletonRows = 5
/** A word of more characters may be broken; see markLongWords. */
const longWord = /[^\s-]{25}/

/**
 * Columns are never narrower than their longest word, except where a word is so long that it
 * would push the table out of its box: those cells are marked, and their words may be broken.
 * CSS alone cannot tell the two apart.
 */
function markLongWords(table: HTMLTableElement) {
  for (const cell of table.querySelectorAll('tbody td, tfoot td')) {
    const texts = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
    let found = false
    while (!found && texts.nextNode()) found = longWord.test(texts.currentNode.nodeValue ?? '')
    cell.toggleAttribute('data-long-word', found)
  }
}

export function Table<T>({
  caption, hideCaption = false, columns, rows, rowKey, rowLabel, status = 'ready', empty, error, onRetry, defaultSort, pageSize = 25,
  selected, onSelectedChange, rowActions, narrow = 'stack',
}: TableProps<T>) {
  const captionId = useId()
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const table = useRef<HTMLTableElement>(null)
  const [sort, setSort] = useState<TableSort | null>(defaultSort ?? null)
  const [wantedPage, setWantedPage] = useState(1)
  const [overflows, setOverflows] = useState(false)
  const stacked = useMediaQuery(narrowQuery) && narrow === 'stack'

  useLayoutEffect(() => {
    if (table.current) markLongWords(table.current)
  })

  // A table with more columns than fit scrolls, which must be possible with the keyboard.
  useEffect(() => {
    const element = scroller.current
    if (!element || !table.current || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => setOverflows(element.scrollWidth > element.clientWidth + 1))
    observer.observe(element)
    observer.observe(table.current)
    return () => observer.disconnect()
  }, [])

  const sorted = useMemo(() => {
    const valueOf = columns.find((column) => column.id === sort?.columnId)?.sortValue
    return sort && valueOf ? sortRows(rows, valueOf, sort.direction) : rows
  }, [rows, columns, sort])
  const { rows: pageRows, page, pageCount, summary } = pageOf(sorted, wantedPage, pageSize)

  const sortable = columns.filter((column) => column.sortValue)
  const selectable = selected !== undefined && onSelectedChange !== undefined
  const columnCount = columns.length + Number(selectable) + Number(rowActions !== undefined)
  const hasRows = status === 'ready' && rows.length > 0
  const hasTools = stacked && hasRows && (sortable.length > 0 || selectable)
  const hasTotals = hasRows && columns.some((column) => column.total !== undefined)

  const changeSort = (next: TableSort) => {
    setSort(next)
    setWantedPage(1)
    const header = columns.find((column) => column.id === next.columnId)?.header
    announce(`Sorted by ${header}, ${next.direction}`)
  }
  const changePage = (next: number) => {
    setWantedPage(next)
    announce(`Showing ${pageOf(sorted, next, pageSize).summary}`)
  }

  const pageKeys = pageRows.map(rowKey)
  const selectedOnPage = selected ? pageKeys.filter((key) => selected.has(key)).length : 0
  const allOnPage = selectedOnPage > 0 && selectedOnPage === pageKeys.length
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(selected)
    for (const key of keys) {
      if (on) next.add(key)
      else next.delete(key)
    }
    onSelectedChange?.(next)
  }
  const selectAll = (hideLabel: boolean) => (
    <Checkbox
      label="Select all rows on this page"
      hideLabel={hideLabel}
      checked={allOnPage}
      indeterminate={selectedOnPage > 0 && !allOnPage}
      onChange={() => toggle(pageKeys, !allOnPage)}
    />
  )

  const body = () => {
    if (status === 'loading') {
      return Array.from({ length: skeletonRows }, (_, row) => (
        <tr key={row} role="row" className="table-skeleton">
          {Array.from({ length: columnCount }, (_, column) => (
            <td key={column} role="cell">
              <Skeleton lines={1} />
            </td>
          ))}
        </tr>
      ))
    }
    if (status === 'error' || rows.length === 0) {
      return (
        <tr role="row" className="table-state">
          <td role="cell" colSpan={columnCount}>
            {status === 'error' ? (
              <ErrorState
                message={error ?? 'This could not be loaded.'}
                onRetry={() => {
                  // The button goes when loading starts.
                  box.current?.focus()
                  onRetry?.()
                }}
              />
            ) : (
              <EmptyState title="Nothing here yet" description="There is nothing to show." {...empty} />
            )}
          </td>
        </tr>
      )
    }
    return pageRows.map((row) => {
      const key = rowKey(row)
      const name = rowLabel(row)
      const isSelected = selected?.has(key) ?? false
      return (
        <tr key={key} role="row" className={classNames(isSelected && 'is-selected')}>
          {selectable && (
            <td role="cell" className="table-select">
              <Checkbox label={`Select ${name}`} hideLabel checked={isSelected} onChange={(on) => toggle([key], on)} />
            </td>
          )}
          {columns.map((column) => (
            <td key={column.id} role="cell" className={classNames(column.numeric && 'is-numeric', column.nowrap && 'is-nowrap')}>
              <span className="cell-label">{column.header}</span>
              <span className="cell-value">{column.cell(row)}</span>
            </td>
          ))}
          {rowActions && (
            <td role="cell" className="table-actions">
              {rowActions(row)}
            </td>
          )}
        </tr>
      )
    })
  }

  // The roles repeat what the elements mean, because browsers drop that when rows are shown as blocks.
  return (
    <div ref={box} tabIndex={-1} className={classNames('table-box', `table-narrow-${narrow}`)}>
      {status === 'loading' && (
        <p className="sr-only" role="status">
          Loading {caption}...
        </p>
      )}
      {/* Above the tools and outside what scrolls, where the table's own caption cannot be. */}
      {!hideCaption && (
        <p className="table-caption" aria-hidden="true">
          {caption}
        </p>
      )}
      {hasTools && (
        <div className="table-tools">
          {sortable.length > 0 && (
            <div className="table-sort">
              <Select
                label="Sort by"
                value={sort?.columnId ?? ''}
                placeholder={sort ? undefined : 'Choose a column'}
                options={sortable.map((column) => ({ value: column.id, label: column.header }))}
                onChange={(columnId) => columnId && changeSort({ columnId, direction: sort?.direction ?? 'ascending' })}
              />
              {sort && (
                <Button
                  icon={sort.direction === 'ascending' ? 'arrowUp' : 'arrowDown'}
                  onClick={() =>
                    changeSort({ ...sort, direction: sort.direction === 'ascending' ? 'descending' : 'ascending' })
                  }
                >
                  {sort.direction === 'ascending' ? 'Ascending' : 'Descending'}
                </Button>
              )}
            </div>
          )}
          {selectable && selectAll(false)}
        </div>
      )}
      <div
        ref={scroller}
        className="table-scroll"
        {...(narrow === 'scroll' || overflows ? { role: 'region', tabIndex: 0, 'aria-labelledby': captionId } : undefined)}
      >
        <table ref={table} className="table" role="table" aria-busy={status === 'loading' || undefined}>
          <caption id={captionId} className="sr-only">
            {caption}
          </caption>
          <thead role="rowgroup">
            <tr role="row">
              {selectable && (
                <th role="columnheader" scope="col" className="table-select">
                  {/* One of the two "select all" checkboxes is shown; see table-tools. */}
                  {hasRows && !stacked ? selectAll(true) : <span className="sr-only">Selected</span>}
                </th>
              )}
              {columns.map((column) => {
                const direction = sort?.columnId === column.id ? sort.direction : null
                return (
                  <th
                    key={column.id}
                    role="columnheader"
                    scope="col"
                    className={classNames(column.numeric && 'is-numeric')}
                    aria-sort={column.sortValue ? (direction ?? 'none') : undefined}
                  >
                    {column.sortValue ? (
                      <>
                        <button
                          type="button"
                          className="sort-button"
                          onClick={() =>
                            changeSort({
                              columnId: column.id,
                              direction: direction === 'ascending' ? 'descending' : 'ascending',
                            })
                          }
                        >
                          {column.header}
                          <Icon
                            name={direction === 'ascending' ? 'arrowUp' : direction === 'descending' ? 'arrowDown' : 'sort'}
                          />
                        </button>
                        {/* Buttons are not printed. */}
                        <span className="print-only" aria-hidden="true">
                          {column.header}
                        </span>
                      </>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
              {rowActions && (
                <th role="columnheader" scope="col" className="table-actions">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody role="rowgroup">{body()}</tbody>
          {hasTotals && (
            <tfoot role="rowgroup">
              <tr role="row">
                {selectable && <td role="cell" className="table-select" />}
                {columns.map((column, index) => (
                  <td
                    key={column.id}
                    role="cell"
                    className={classNames(column.numeric && 'is-numeric', column.total === undefined && index > 0 && 'is-blank')}
                  >
                    {column.total !== undefined && <span className="cell-label">{column.header}</span>}
                    <span className="cell-value">{column.total ?? (index === 0 ? 'Total' : null)}</span>
                  </td>
                ))}
                {rowActions && <td role="cell" className="table-actions is-blank" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {hasRows && (
        <div className="table-footer">
          <p>
            <span className="table-range">{summary}</span>
            {selectable && selected.size > 0 && <span className="table-count"> · {selected.size} selected</span>}
          </p>
          {pageCount > 1 && (
            <nav className="pager" aria-label={`Pages of ${caption}`}>
              <IconButton
                icon="chevronLeft"
                variant="secondary"
                label="Previous page"
                // Not `disabled`: the button just pressed would lose focus.
                aria-disabled={page === 1 || undefined}
                onClick={() => changePage(page - 1)}
              />
              <span className="pager-place">
                Page {page} of {pageCount}
              </span>
              <IconButton
                icon="chevronRight"
                variant="secondary"
                label="Next page"
                aria-disabled={page === pageCount || undefined}
                onClick={() => changePage(page + 1)}
              />
            </nav>
          )}
        </div>
      )}
    </div>
  )
}
