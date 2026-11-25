import { requireActor } from '../../auth/access'
import { approveRequest, declineRequest, readRequests, switchSignUp } from '../../people/requests'
import { jsonBody } from '../body'
import { flag, id, ids, pathId, readInput } from '../input'
import type { AddRoutes } from './types'

/** Requests to join, for those who manage people. */
export const requestRoutes: AddRoutes = (api, access, ctx) => {
  api.get('/requests', access.permission('people.manage'), async (_req, res) => {
    res.json(await readRequests(ctx.db, requireActor(res)))
  })

  api.put('/requests/enabled', access.permission('people.manage'), jsonBody, async (req, res) => {
    const { enabled } = readInput(req.body, { enabled: flag })
    await switchSignUp(ctx, requireActor(res), enabled)
    res.json(await readRequests(ctx.db, requireActor(res)))
  })

  api.post('/requests/:id/approve', access.permission('people.manage'), jsonBody, async (req, res) => {
    const input = readInput(req.body, { roleId: id, clientIds: ids, projectIds: ids })
    await approveRequest(ctx, requireActor(res), pathId(req.params.id), input)
    res.json(await readRequests(ctx.db, requireActor(res)))
  })

  api.post('/requests/:id/decline', access.permission('people.manage'), async (req, res) => {
    await declineRequest(ctx, requireActor(res), pathId(req.params.id))
    res.json(await readRequests(ctx.db, requireActor(res)))
  })
}
