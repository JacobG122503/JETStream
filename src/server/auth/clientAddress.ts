import { isIP } from 'node:net'
import type { Request } from 'express'

/**
 * The address limits count by: an IPv4 address, or the /64 network of an IPv6 address, because one
 * customer usually has a whole such network. Express has applied TRUST_PROXY.
 */
export function clientAddress(req: Request): string {
  return limitAddress(req.ip) ?? limitAddress(req.socket.remoteAddress) ?? 'unknown'
}

export function limitAddress(value: string | undefined): string | undefined {
  const address = value?.replace(/%.*$/, '') ?? ''
  if (isIP(address) === 4) return address
  if (isIP(address) !== 6) return undefined
  const groups = expand(address)
  // An IPv4 address in IPv6 form is that address.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6)
    return [high >> 8, high & 255, low >> 8, low & 255].join('.')
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`
}

/** The eight groups of a valid IPv6 address. */
function expand(address: string): number[] {
  const numbers = (part: string) =>
    part.split(':').filter(Boolean).flatMap((group) => {
      if (!group.includes('.')) return [parseInt(group, 16)]
      const [a = 0, b = 0, c = 0, d = 0] = group.split('.').map(Number)
      return [a * 256 + b, c * 256 + d]
    })
  const [before = '', after] = address.split('::')
  const start = numbers(before)
  if (after === undefined) return start
  const end = numbers(after)
  return [...start, ...Array<number>(8 - start.length - end.length).fill(0), ...end]
}
