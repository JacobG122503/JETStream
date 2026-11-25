import { clientAddress } from '../../auth/clientAddress'
import { sessionOf } from '../../auth/access'
import { clearSessionCookie, endSession } from '../../auth/sessions'
import { beginSession, checkSignIn, findDemoAccount, readSessionInfo } from '../../auth/signIn'
import { demoAccounts } from '../../demo/accounts'
import { jsonBody } from '../body'
import { knownEmail, oneOf, optionalFlag, password, readInput } from '../input'
import type { AddRoutes } from './types'

/** Signing in and out, and who is signed in. */
export const sessionRoutes: AddRoutes = (api, access, ctx) => {
  api.get('/session', access.public, async (req, res) => {
    res.json(await readSessionInfo(ctx, req))
  })

  api.post('/session/sign-in', access.public, jsonBody, async (req, res) => {
    const input = readInput(req.body, { email: knownEmail, password, keep: optionalFlag })
    const proof = await checkSignIn(ctx, { ...input, address: clientAddress(req) })
    await beginSession(ctx, req, res, proof, input.keep, sessionOf(res))
    res.json(await readSessionInfo(ctx, req))
  })

  if (ctx.demo) {
    const account = oneOf(...demoAccounts.map(({ key }) => key))
    api.post('/session/demo', access.public, jsonBody, async (req, res) => {
      const input = readInput(req.body, { account })
      await beginSession(ctx, req, res, await findDemoAccount(ctx, input.account), false, sessionOf(res))
      res.json(await readSessionInfo(ctx, req))
    })
  }

  api.post('/session/sign-out', access.public, async (req, res) => {
    const session = sessionOf(res)
    if (session) await endSession(ctx.db, session.id)
    clearSessionCookie(ctx, res)
    delete req.headers.cookie
    res.json(await readSessionInfo(ctx, req))
  })
}
