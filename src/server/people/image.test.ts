import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { cleanImage, crc32, ImageError } from './image'
import { jpeg, png, pngChunk, withExif } from '../testing/images'

const refused = (file: Buffer) => {
  expect(() => cleanImage(file)).toThrow(ImageError)
}

describe('PNG', () => {
  it('keeps a picture as it is', () => {
    const file = png(64, 48)
    expect(cleanImage(file)).toEqual({ mediaType: 'image/png', content: file })
    expect(cleanImage(png(1024, 1024)).mediaType).toBe('image/png')
  })

  it('drops text, EXIF, colour profiles, animation and what follows the end', () => {
    const file = png(8, 8, [
      pngChunk('tEXt', Buffer.from('Comment\0secret place')),
      pngChunk('eXIf', Buffer.from('secret GPS')),
      pngChunk('iCCP', Buffer.from('secret\0\0x')),
      pngChunk('zTXt', Buffer.from('secret')),
      pngChunk('acTL', Buffer.from('secret')),
    ])
    const { content } = cleanImage(Buffer.concat([file, Buffer.from('<script>secret</script>')]))
    expect(content.equals(png(8, 8))).toBe(true)
    expect(content.toString('latin1')).not.toContain('secret')
  })

  it('refuses a picture that is too large, empty, cut off or damaged', () => {
    for (const file of [png(1025, 8), png(8, 1025), png(5000, 10), png(0, 8)]) refused(file)
    const file = png(32, 32)
    for (let length = 0; length < file.length; length++) refused(file.subarray(0, length))
    for (const at of [16, 20, 30, 45, file.length - 2]) {
      const damaged = Buffer.from(file)
      damaged[at] = (damaged[at] ?? 0) ^ 0x55
      refused(damaged)
    }
  })

  it('refuses data that does not fill the picture, or is far more than it', () => {
    const header = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])])
    const ihdr = Buffer.from([0, 0, 0, 8, 0, 0, 0, 8, 8, 2, 0, 0, 0])
    const make = (data: Buffer) =>
      Buffer.concat([header, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(data)), pngChunk('IEND', Buffer.alloc(0))])
    expect(cleanImage(make(Buffer.alloc(8 * 25))).mediaType).toBe('image/png')
    refused(make(Buffer.alloc(8 * 25 - 1)))
    refused(make(Buffer.alloc(8 * 25 + 1)))
    refused(make(Buffer.alloc(50_000_000)))
    const chunks = (data: Buffer, ...before: Buffer[]) =>
      Buffer.concat([header, pngChunk('IHDR', ihdr), ...before, pngChunk('IDAT', data), pngChunk('IEND', Buffer.alloc(0))])
    const data = deflateSync(Buffer.alloc(8 * 25))
    // After the end of the compressed picture, in the same part or in one more.
    refused(chunks(Buffer.concat([data, Buffer.from('secret')])))
    refused(Buffer.concat([chunks(data).subarray(0, -12), pngChunk('IDAT', Buffer.from('secret')), chunks(data).subarray(-12)]))
    // Parts that mean nothing for a picture in true colours.
    const text = Buffer.from('a secret place')
    expect(cleanImage(chunks(data, pngChunk('PLTE', text), pngChunk('tRNS', text))).content.equals(chunks(data))).toBe(true)
    const transparent = chunks(data, pngChunk('tRNS', Buffer.alloc(6)))
    expect(cleanImage(transparent).content.equals(transparent)).toBe(true)
    refused(Buffer.concat([header, pngChunk('IHDR', ihdr), pngChunk('IEND', Buffer.alloc(0))]))
    refused(Buffer.concat([header, pngChunk('IEND', Buffer.alloc(0))]))
  })

  it('reads interlaced pictures', () => {
    // 5 by 5 grey, seven passes: 1+1, 1+1, 1+2, 2*(1+1)... as bytes of each pass.
    const passes = [[1, 1], [1, 1], [1, 2], [2, 1], [1, 3], [3, 2], [2, 5]] as const
    const size = passes.reduce((sum, [rows, width]) => sum + rows * (1 + width), 0)
    const ihdr = Buffer.from([0, 0, 0, 5, 0, 0, 0, 5, 8, 0, 0, 0, 1])
    const make = (bytes: number) =>
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.alloc(bytes))), pngChunk('IEND', Buffer.alloc(0)),
      ])
    expect(cleanImage(make(size)).mediaType).toBe('image/png')
    refused(make(size - 1))
  })
})

describe('JPEG', () => {
  it('keeps the picture and drops EXIF, comments, profiles, thumbnails and what follows the end', () => {
    const plain = jpeg()
    expect(cleanImage(plain)).toEqual({ mediaType: 'image/jpeg', content: plain })
    const file = withExif(plain, 'GPS 41.8781 -87.6298 secret')
    expect(file.toString('latin1')).toContain('secret')
    const { content } = cleanImage(Buffer.concat([file, Buffer.from('<html>secret')]))
    expect(content.equals(plain)).toBe(true)
  })

  it('refuses a picture that is too large, cut off or damaged', () => {
    refused(jpeg(1025, 8))
    refused(jpeg(8, 1025))
    refused(jpeg(0, 8))
    const file = jpeg()
    for (let length = 0; length < file.length; length++) refused(file.subarray(0, length))
    refused(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    refused(Buffer.concat([file.subarray(0, 2), Buffer.from([0xff, 0x00, 0, 2]), file.subarray(2)]))
  })
})

it('refuses everything else', () => {
  for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '<!doctype html><script>alert(1)</script>', 'GIF89a', 'RIFF....WEBPVP8 ', '']) {
    refused(Buffer.from(text))
  }
  refused(Buffer.concat([png(8, 8), Buffer.alloc(1024 * 1024)]))
})

it('has the right checksum', () => {
  expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
})
