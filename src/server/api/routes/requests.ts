import type { JoinRequests } from '../../../shared/api'
import { requireSession } from '../../auth/access'
import type { AppContext } from '../../context'
import { getSettings } from '../../people/lookup'
import { approveRequest, declineRequest, listRequests, switchSignUp } from '../../people/requests'
import { jsonBody } from '../body'
import { flag, id, ids, pathId, readInput } from '../input'
import type { AddRoutes } from './types'

async function overview(ctx: AppContext): Promise<JoinRequests> {
  return { enabled: (await getSettings(ctx.db)).signUpEnabled, requests: await listRequests(ctx.db) }
}

/** Requests to join, for administrators. */
export const requestRoutes: AddRoutes = (api, access, ctx) => {
  api.get('/requests', access.administrator, async (_req, res) => {
    res.json(await overview(ctx))
  })

  api.put('/requests/enabled', access.administrator, jsonBody, async (req, res) => {
    const { enabled } = readInput(req.body, { enabled: flag })
    await switchSignUp(ctx, enabled, requireSession(res).person.id)
    res.json(await overview(ctx))
  })

  api.post('/requests/:id/approve', access.administrator, jsonBody, async (req, res) => {
    const input = readInput(req.body, { roleId: id, clientIds: ids, projectIds: ids })
    await approveRequest(ctx, pathId(req.params.id), input, requireSession(res).person.id)
    res.json(await overview(ctx))
  })

  api.post('/requests/:id/decline', access.administrator, async (req, res) => {
    await declineRequest(ctx, pathId(req.params.id), requireSession(res).person.id)
    res.json(await overview(ctx))
  })
}
