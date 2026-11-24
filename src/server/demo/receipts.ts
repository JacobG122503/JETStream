/** Small files that open like real receipts, drawn here so that nothing is copied from anywhere. */
import { deflateSync } from 'node:zlib'

interface Receipt {
  title: string
  date: string
  amount: number
  currency: string
}

const linesOf = ({ title, date, amount, currency }: Receipt) => [
  title, `Date: ${date}`, `Total: ${currency} ${(amount / 100).toFixed(2)}`, 'Fictional, for demonstration only',
]

/** A one-page PDF in a standard font. */
export function pdfReceipt(receipt: Receipt): Buffer {
  const text = linesOf(receipt)
    .map((line, index) => `1 0 0 1 24 ${240 - index * 28} Tm (${line}) Tj`)
    .join('\n')
  const page = `BT /F1 14 Tf\n${text}\nET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 288] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${page.length} >>\nstream\n${page}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let file = '%PDF-1.4\n'
  const offsets = objects.map((body, index) => {
    const offset = file.length
    file += `${index + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const table = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  const size = objects.length + 1
  file += `xref\n0 ${size}\n0000000000 65535 f \n${table}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${file.length}\n%%EOF\n`
  return Buffer.from(file, 'latin1')
}

/** Digits as 3x5 dots, one row per string. */
const digits: Record<string, string[]> = {
  '0': ['###', '# #', '# #', '# #', '###'],
  '1': [' # ', '## ', ' # ', ' # ', '###'],
  '2': ['###', '  #', '###', '#  ', '###'],
  '3': ['###', '  #', '###', '  #', '###'],
  '4': ['# #', '# #', '###', '  #', '  #'],
  '5': ['###', '#  ', '###', '  #', '###'],
  '6': ['###', '#  ', '###', '# #', '###'],
  '7': ['###', '  #', '  #', '  #', '  #'],
  '8': ['###', '# #', '###', '# #', '###'],
  '9': ['###', '# #', '###', '  #', '###'],
  '.': ['   ', '   ', '   ', '   ', ' # '],
  '-': ['   ', '   ', '###', '   ', '   '],
}

/** A greyscale picture with the date, some lines and the total. */
export function pngReceipt({ date, amount }: Receipt): Buffer {
  const [width, height] = [240, 320]
  const pixels = Buffer.alloc(width * height, 250)
  const fill = (x: number, y: number, w: number, h: number, shade: number) => {
    for (let row = y; row < y + h; row++) pixels.fill(shade, row * width + x, row * width + x + w)
  }
  const write = (text: string, x: number, y: number, size: number) => {
    for (const [index, character] of [...text].entries()) {
      for (const [row, dots] of (digits[character] ?? []).entries()) {
        for (const [column, dot] of [...dots].entries()) {
          if (dot === '#') fill(x + (index * 4 + column) * size, y + row * size, size, size, 40)
        }
      }
    }
  }
  fill(24, 20, 192, 24, 120)
  write(date, 24, 64, 4)
  for (let line = 0; line < 6; line++) fill(24, 110 + line * 22, 100 + ((line * 37) % 60), 8, 200)
  fill(24, 250, 192, 2, 60)
  write((amount / 100).toFixed(2), 24, 268, 6)

  // Each row starts with a filter type, 0.
  const raw = Buffer.alloc((width + 1) * height)
  for (let row = 0; row < height; row++) pixels.copy(raw, row * (width + 1) + 1, row * width, (row + 1) * width)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // Bits per pixel, greyscale.
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
