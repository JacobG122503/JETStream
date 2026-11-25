import type { Request, Response } from 'express'
import { clientAddress } from '../../auth/clientAddress'
import { sessionOf } from '../../auth/access'
import { takeAttempt } from '../../auth/limits'
import { openSession, readSessionInfo } from '../../auth/signIn'
import type { AppContext } from '../../context'
import { ApiError } from '../../errors'
import { acceptInvite, readInvite } from '../../people/invites'
import { signUp } from '../../people/requests'
import { askForHelp, readReset, usePasswordReset } from '../../people/resets'
import { jsonBody } from '../body'
import { anything, knownEmail, newEmail, password, personName, readInput, timeZone } from '../input'
import type { AddRoutes } from './types'

/** What people without a session do: ask to join, ask for help, use a link. */
export const linkRoutes: AddRoutes = (api, access, ctx) => {
  api.post('/sign-up', access.public, jsonBody, async (req, res) => {
    const input = readInput(req.body, { name: personName, email: newEmail, password, timeZone })
    await signUp(ctx, input, clientAddress(req))
    res.status(202).json({ status: 'received' })
  })

  api.post('/forgot-password', access.public, jsonBody, async (req, res) => {
    const { email } = readInput(req.body, { email: knownEmail })
    await askForHelp(ctx, email, clientAddress(req))
    res.status(202).json({ status: 'received' })
  })

  api.post('/invite/check', access.public, jsonBody, async (req, res) => {
    const { token } = readInput(req.body, { token: anything })
    res.json(await withLinkLimit(ctx, req, () => readInvite(ctx, token)))
  })

  api.post('/invite/accept', access.public, jsonBody, async (req, res) => {
    refuseSignedIn(res)
    const { token } = readInput(req.body, { token: anything })
    const session = await withLinkLimit(ctx, req, async () => {
      // A link that does not work is told before what else is wrong.
      await readInvite(ctx, token)
      const input = readInput(req.body, { name: personName, password, timeZone })
      return acceptInvite(ctx, req, { ...input, token })
    })
    openSession(ctx, req, res, session)
    res.json(await readSessionInfo(ctx, req))
  })

  api.post('/reset-password/check', access.public, jsonBody, async (req, res) => {
    const { token } = readInput(req.body, { token: anything })
    res.json(await withLinkLimit(ctx, req, () => readReset(ctx, token)))
  })

  api.post('/reset-password/use', access.public, jsonBody, async (req, res) => {
    refuseSignedIn(res)
    const { token } = readInput(req.body, { token: anything })
    await withLinkLimit(ctx, req, async () => {
      await readReset(ctx, token)
      const input = readInput(req.body, { password })
      await usePasswordReset(ctx, { ...input, token })
    })
    res.json({ status: 'done' })
  })
}

function refuseSignedIn(res: Response) {
  if (sessionOf(res)) throw new ApiError(409, 'signed_in', 'Sign out first.')
}

/** Counts only links that do not work. */
async function withLinkLimit<T>(ctx: AppContext, req: Request, work: () => Promise<T>): Promise<T> {
  const attempt = await takeAttempt(ctx, 'link', { address: clientAddress(req) })
  try {
    const result = await work()
    await attempt.succeeded()
    return result
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'link_invalid') await attempt.succeeded()
    throw error
  }
}
