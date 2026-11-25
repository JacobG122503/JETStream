import type { AppContext } from '../context'
import { ApiError } from '../errors'

/** The token is in the fragment, which browsers do not send. Made from PUBLIC_URL, never from the request. */
export function linkTo(ctx: AppContext, page: 'invite' | 'reset-password', token: string): string {
  return `${ctx.publicUrl}${page}#${token}`
}

/** The same answer for every link that does not work, whatever the reason. */
export const linkInvalid = () => new ApiError(410, 'link_invalid', 'This link no longer works')
