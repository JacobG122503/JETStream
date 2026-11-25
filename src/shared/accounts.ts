/** Rules about accounts that both sides show or check. */

export const passwordLength = { min: 10, max: 128 } as const
export const nameLength = { min: 1, max: 100 } as const
export const emailMaxLength = 254

export const photoLimits = { bytes: 1024 * 1024, pixels: 1024, sourceBytes: 10 * 1024 * 1024 } as const

/** Trimmed and in lower case, which is how emails are stored and compared. */
export function normalizeEmail(text: string): string {
  return text.trim().toLowerCase()
}

/** Plain ASCII addresses with a dot in the domain; whether mail arrives nobody can tell from the text. */
export function isEmail(text: string): boolean {
  return (
    text.length <= emailMaxLength &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(text)
  )
}

/** In characters, after trimming. */
export const roleNameLength = 60
export const roleDescriptionLength = 200
