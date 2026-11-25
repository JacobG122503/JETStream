import type { Db } from './db'
import type { EmailSender } from './email/sender'

/** What the routes and services of one running server share. */
export interface AppContext {
  db: Db
  /** The clock; tests set it. Sessions, links and limits use nothing else. */
  now: () => Date
  /** Starts and ends with "/". */
  basePath: string
  /** The address people use, ending with the base path. Links are made from this only. */
  publicUrl: string
  /** Development and demo: also accept the address a request was sent to as the app's own. */
  acceptHostOrigin: boolean
  /** Demo mode, which offers sign-in without a password. */
  demo: boolean
  email: EmailSender
}
