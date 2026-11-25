import { productName } from '../../shared/product'

/** A spreadsheet would run a text that begins like a formula. Numbers stay numbers. */
const cellText = (value: string | number): string => {
  const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

export const toCsv = (rows: (string | number)[][]): string => rows.map((cells) => cells.map(cellText).join(',')).join('\r\n')

export function saveFile(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

/** Excel reads the file as UTF-8 only with the mark at its start. */
export const downloadCsv = (name: string, rows: (string | number)[][]) => saveFile(`${productName} ${name}.csv`, `\ufeff${toCsv(rows)}`, 'text/csv')
