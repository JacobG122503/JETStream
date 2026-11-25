import { requireSession } from '../../auth/access'
import { createInvite, listInvites, renewInvite, revokeInvite } from '../../people/invites'
import { jsonBody } from '../body'
import { id, ids, newEmail, pathId, personName, readInput } from '../input'
import type { AddRoutes } from './types'

/** Invites, for administrators. Their links are used in links.ts. */
export const inviteRoutes: AddRoutes = (api, access, ctx) => {
  api.get('/invites', access.administrator, async (_req, res) => {
    res.json({ invites: await listInvites(ctx.db, ctx.now()) })
  })

  api.post('/invites', access.administrator, jsonBody, async (req, res) => {
    const input = readInput(req.body, { name: personName, email: newEmail, roleId: id, clientIds: ids, projectIds: ids })
    res.status(201).json(await createInvite(ctx, input, requireSession(res).person))
  })

  api.post('/invites/:id/link', access.administrator, async (req, res) => {
    res.status(201).json(await renewInvite(ctx, pathId(req.params.id), requireSession(res).person))
  })

  api.post('/invites/:id/revoke', access.administrator, async (req, res) => {
    await revokeInvite(ctx, pathId(req.params.id), requireSession(res).person)
    res.json({ invites: await listInvites(ctx.db, ctx.now()) })
  })
}
