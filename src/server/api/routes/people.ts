import type { SavedAssignments } from '../../../shared/api'
import { requireActor } from '../../auth/access'
import { saveAssignments } from '../../people/assignments'
import { listPeople, readOptions, readPerson } from '../../people/people'
import { createResetLink, listHelpRequests } from '../../people/resets'
import { jsonBody } from '../body'
import { ids, pathId, readInput, shortText } from '../input'
import type { AddRoutes } from './types'

/** People and their assignments. */
export const peopleRoutes: AddRoutes = (api, access, ctx) => {
  api.get('/people', access.permission('people.view'), async (_req, res) => {
    res.json({ people: await listPeople(ctx.db, requireActor(res), ctx.now()) })
  })

  api.get('/people/options', access.permission('people.manage'), async (_req, res) => {
    res.json(await readOptions(ctx.db, requireActor(res)))
  })

  api.get('/people/:id', access.permission('people.view'), async (req, res) => {
    res.json(await readPerson(ctx.db, requireActor(res), pathId(req.params.id), ctx.now()))
  })

  api.put('/people/:id/assignments', access.permission('people.manage'), jsonBody, async (req, res) => {
    const personId = pathId(req.params.id)
    const actor = requireActor(res)
    const input = readInput(req.body, { clientIds: ids, projectIds: ids, state: shortText })
    const notManaged = await saveAssignments(ctx.db, actor, { ...input, personId, now: ctx.now() })
    const saved: SavedAssignments = { ...(await readPerson(ctx.db, actor, personId, ctx.now())), notManaged }
    res.json(saved)
  })

  api.post('/people/:id/reset-link', access.permission('people.manage'), async (req, res) => {
    res.status(201).json(await createResetLink(ctx, requireActor(res), pathId(req.params.id)))
  })

  api.get('/help-requests', access.permission('people.manage'), async (_req, res) => {
    res.json({ requests: await listHelpRequests(ctx.db, requireActor(res)) })
  })
}
