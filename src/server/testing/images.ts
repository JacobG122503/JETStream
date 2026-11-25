/** Small pictures for tests. */
import { deflateSync } from 'node:zlib'
import { crc32 } from '../people/image'

export function pngChunk(type: string, content: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), content])
  const result = Buffer.alloc(body.length + 8)
  result.writeUInt32BE(content.length, 0)
  body.copy(result, 4)
  result.writeUInt32BE(crc32(body), body.length + 4)
  return result
}

/** A black RGB picture. */
export function png(width: number, height: number, extra: Buffer[] = []): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    ...extra,
    pngChunk('IDAT', deflateSync(Buffer.alloc(height * (1 + width * 3)))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const segment = (marker: number, content: number[] | Buffer) => {
  const data = Buffer.from(content)
  const head = Buffer.from([0xff, marker, 0, 0])
  head.writeUInt16BE(data.length + 2, 2)
  return Buffer.concat([head, data])
}

/** A grey picture: 8 by 8 unless told otherwise, in which case only the header is right. */
export function jpeg(width = 8, height = 8): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    segment(0xdb, [0, ...Array<number>(64).fill(1)]),
    segment(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]),
    // One code of one bit each: no difference, and end of block.
    segment(0xc4, [0x00, 1, ...Array<number>(15).fill(0), 0]),
    segment(0xc4, [0x10, 1, ...Array<number>(15).fill(0), 0]),
    segment(0xda, [1, 1, 0x00, 0, 63, 0]),
    Buffer.from([0x3f]),
    Buffer.from([0xff, 0xd9]),
  ])
}

/** The picture with what cameras and editors add. */
export function withExif(file: Buffer, text: string): Buffer {
  return Buffer.concat([
    file.subarray(0, 2),
    segment(0xe1, Buffer.from(`Exif\0\0${text}`)),
    segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    segment(0xe0, Buffer.from(`JFXX\0${text}`)),
    segment(0xe2, Buffer.from(`ICC_PROFILE\0${text}`)),
    segment(0xed, Buffer.from(`Photoshop ${text}`)),
    segment(0xfe, Buffer.from(text)),
    file.subarray(2 + 18),
  ])
}
