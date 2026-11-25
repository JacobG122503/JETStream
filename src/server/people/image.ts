/**
 * Reads PNG and JPEG files without trusting their name or declared type, and writes them again with
 * nothing but what a picture needs: no EXIF, no text, no colour profile, nothing after the end.
 */
import { inflateSync } from 'node:zlib'
import { photoLimits } from '../../shared/accounts'

export interface CleanImage {
  mediaType: 'image/png' | 'image/jpeg'
  content: Buffer
}

/** Not a picture that is accepted; the message is for whoever uploaded it. */
export class ImageError extends Error {}

const refuse = (message = 'The file is damaged or not a PNG or JPEG picture.'): never => {
  throw new ImageError(message)
}

export function cleanImage(file: Buffer): CleanImage {
  if (file.length > photoLimits.bytes) refuse('The picture is larger than 1 MB.')
  if (file.subarray(0, 8).equals(pngSignature)) return { mediaType: 'image/png', content: cleanPng(file) }
  if (file[0] === 0xff && file[1] === 0xd8) return { mediaType: 'image/jpeg', content: cleanJpeg(file) }
  return refuse()
}

function checkSize(width: number, height: number) {
  if (width < 1 || height < 1) refuse()
  if (width > photoLimits.pixels || height > photoLimits.pixels) {
    refuse(`The picture is larger than ${photoLimits.pixels} by ${photoLimits.pixels} pixels.`)
  }
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Channels by colour type, and the bit depths allowed for it. */
const pngColours: Record<number, { channels: number; depths: number[] }> = {
  0: { channels: 1, depths: [1, 2, 4, 8, 16] },
  2: { channels: 3, depths: [8, 16] },
  3: { channels: 1, depths: [1, 2, 4, 8] },
  4: { channels: 2, depths: [8, 16] },
  6: { channels: 4, depths: [8, 16] },
}

function cleanPng(file: Buffer): Buffer {
  const kept: Buffer[] = [pngSignature]
  const data: Buffer[] = []
  let header: { width: number; height: number; bitsPerPixel: number; interlaced: boolean; palette: boolean; transparency: (length: number) => boolean } | undefined
  let seen = ''
  for (let at = 8; ; ) {
    if (at + 12 > file.length) refuse()
    const length = file.readUInt32BE(at)
    const end = at + 12 + length
    if (end > file.length) refuse()
    const type = file.toString('latin1', at + 4, at + 8)
    const content = file.subarray(at + 8, at + 8 + length)
    if (file.readUInt32BE(end - 4) !== crc32(file.subarray(at + 4, end - 4))) refuse()
    if ((header === undefined) !== (type === 'IHDR')) refuse()
    if (type === 'IHDR') {
      if (length !== 13) refuse()
      const [width, height] = [content.readUInt32BE(0), content.readUInt32BE(4)]
      const [depth = 0, colour = -1, compression, filter, interlace = -1] = content.subarray(8)
      const kind = pngColours[colour]
      if (!kind?.depths.includes(depth) || compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) refuse()
      checkSize(width, height)
      header = {
        width, height, bitsPerPixel: (kind?.channels ?? 0) * depth, interlaced: interlace === 1, palette: colour === 3,
        transparency: (size) => (colour === 0 ? size === 2 : colour === 2 ? size === 6 : colour === 3 && size <= 256),
      }
      kept.push(file.subarray(at, end))
    } else if (type === 'PLTE' || type === 'tRNS') {
      if (length === 0 || length > 768 || seen.includes(type) || seen.includes('IDAT')) refuse()
      seen += type
      // Others carry a palette only as a suggestion, or transparency of a size that means nothing.
      if (type === 'PLTE' ? header?.palette : header?.transparency(length)) kept.push(file.subarray(at, end))
    } else if (type === 'IDAT') {
      seen += type
      data.push(content)
      kept.push(file.subarray(at, end))
    } else if (type === 'IEND') {
      if (length !== 0) refuse()
      kept.push(file.subarray(at, end))
      break
    } else if (/^[A-Z]/.test(type) || !/^[A-Za-z]{4}$/.test(type)) {
      refuse() // A part that a reader must understand, and none does.
    }
    at = end
  }
  if (!header || data.length === 0 || (header.palette && !seen.includes('PLTE'))) return refuse()
  const expected = pngDataLength(header)
  try {
    const compressed = Buffer.concat(data)
    const { buffer, engine } = inflateSync(compressed, { maxOutputLength: expected, info: true }) as unknown as Inflated
    // Readers stop at the end of the picture; anything could follow there.
    if (buffer.length !== expected || engine.bytesWritten !== compressed.length) refuse()
  } catch {
    refuse()
  }
  return Buffer.concat(kept)
}

/** What inflateSync gives with `info`, which its types do not know. */
interface Inflated {
  buffer: Buffer
  engine: { bytesWritten: number }
}

interface PngHeader {
  width: number
  height: number
  bitsPerPixel: number
  interlaced: boolean
}

/** Bytes of the uncompressed picture: each row has one more byte than its pixels need. */
function pngDataLength({ width, height, bitsPerPixel, interlaced }: PngHeader): number {
  const bytes = (w: number, h: number) => (w === 0 ? 0 : h * (1 + Math.ceil((w * bitsPerPixel) / 8)))
  if (!interlaced) return bytes(width, height)
  // Start and step, across and down, of the seven passes.
  const passes = [[0, 8, 0, 8], [4, 8, 0, 8], [0, 4, 4, 8], [2, 4, 0, 4], [0, 2, 2, 4], [1, 2, 0, 2], [0, 1, 1, 2]] as const
  return passes.reduce(
    (sum, [x, stepX, y, stepY]) =>
      sum + bytes(Math.max(0, Math.ceil((width - x) / stepX)), Math.max(0, Math.ceil((height - y) / stepY))),
    0,
  )
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

export function crc32(bytes: Buffer): number {
  let value = 0xffffffff
  for (const byte of bytes) value = (crcTable[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

const [soi, eoi, sos, dqt, dht, dri, com] = [0xd8, 0xd9, 0xda, 0xdb, 0xc4, 0xdd, 0xfe]
/** A JFIF part without a thumbnail. */
const jfif = Buffer.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])

function cleanJpeg(file: Buffer): Buffer {
  const kept: Buffer[] = [Buffer.from([0xff, soi])]
  const components = new Set<number>()
  const scanned = new Set<number>()
  let quantised = false
  let huffman = false
  for (let at = 2; ; ) {
    if (file[at] !== 0xff) refuse()
    // A marker may be preceded by fill bytes.
    while (file[at + 1] === 0xff) at++
    const marker = file[at + 1] ?? 0
    if (marker === eoi) break
    if (at + 4 > file.length) refuse()
    const length = file.readUInt16BE(at + 2)
    const end = at + 2 + length
    if (length < 2 || end > file.length) refuse()
    const part = file.subarray(at, end)
    const content = file.subarray(at + 4, end)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const count = content[5] ?? 0
      if (components.size > 0 || ![1, 3, 4].includes(count) || content.length !== 6 + 3 * count || content[0] !== 8) refuse()
      checkSize(content.readUInt16BE(3), content.readUInt16BE(1))
      for (let index = 0; index < count; index++) components.add(content[6 + 3 * index] ?? 0)
      kept.push(part)
    } else if (marker === dqt || marker === dht || marker === dri) {
      quantised ||= marker === dqt
      huffman ||= marker === dht
      kept.push(part)
    } else if (marker === sos) {
      const count = content[0] ?? 0
      if (components.size === 0 || !quantised || !huffman || count < 1 || content.length !== 4 + 2 * count) refuse()
      for (let index = 0; index < count; index++) {
        const id = content[1 + 2 * index] ?? 0
        if (!components.has(id)) refuse()
        scanned.add(id)
      }
      const dataEnd = endOfScan(file, end)
      if (dataEnd === end) refuse()
      kept.push(file.subarray(at, dataEnd))
      at = dataEnd
      continue
    } else if (marker === 0xe0) {
      if (kept.length === 1 && content.toString('latin1', 0, 5) === 'JFIF\0') kept.push(jfif)
    } else if (marker === 0xee) {
      // Adobe's part tells how colours are stored.
      if (content.length === 12 && content.toString('latin1', 0, 5) === 'Adobe') kept.push(part)
    } else if (!(marker >= 0xe1 && marker <= 0xef) && marker !== com) {
      refuse()
    }
    at = end
  }
  if (components.size === 0 || scanned.size !== components.size) refuse()
  kept.push(Buffer.from([0xff, eoi]))
  return Buffer.concat(kept)
}

/** Where the compressed data ends: at the next marker that is neither a restart nor an escaped 255. */
function endOfScan(file: Buffer, start: number): number {
  for (let at = start; at + 1 < file.length; at++) {
    if (file[at] !== 0xff) continue
    const next = file[at + 1] ?? 0
    if (next === 0 || (next >= 0xd0 && next <= 0xd7)) at++
    else if (next !== 0xff) return at
  }
  return refuse()
}
