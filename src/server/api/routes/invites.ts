import { requireActor } from '../../auth/access'
import { createInvite, listInvites, renewInvite, revokeInvite } from '../../people/invites'
import { jsonBody } from '../body'
import { id, ids, newEmail, pathId, personName, readInput } from '../input'
import type { AddRoutes } from './types'

/** Invites, for those who manage people. Their links are used in links.ts. */
export const inviteRoutes: AddRoutes = (api, access, ctx) => {
  api.get('/invites', access.permission('people.manage'), async (_req, res) => {
    res.json({ invites: await listInvites(ctx.db, requireActor(res), ctx.now()) })
  })

  api.post('/invites', access.permission('people.manage'), jsonBody, async (req, res) => {
    const input = readInput(req.body, { name: personName, email: newEmail, roleId: id, clientIds: ids, projectIds: ids })
    res.status(201).json(await createInvite(ctx, requireActor(res), input))
  })

  api.post('/invites/:id/link', access.permission('people.manage'), async (req, res) => {
    res.status(201).json(await renewInvite(ctx, requireActor(res), pathId(req.params.id)))
  })

  api.post('/invites/:id/revoke', access.permission('people.manage'), async (req, res) => {
    await revokeInvite(ctx, requireActor(res), pathId(req.params.id))
    res.json({ invites: await listInvites(ctx.db, requireActor(res), ctx.now()) })
  })
}
