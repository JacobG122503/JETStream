import { requireSession } from '../../auth/access'
import { saveAssignments } from '../../people/assignments'
import { listPeople, readOptions, readPerson } from '../../people/people'
import { createResetLink, listHelpRequests } from '../../people/resets'
import { jsonBody } from '../body'
import { ids, pathId, readInput, shortText } from '../input'
import type { AddRoutes } from './types'

/** People and their assignments, for administrators. */
export const peopleRoutes: AddRoutes = (api, access, ctx) => {
  api.get('/people', access.administrator, async (_req, res) => {
    res.json({ people: await listPeople(ctx.db, ctx.now()) })
  })

  api.get('/people/options', access.administrator, async (_req, res) => {
    res.json(await readOptions(ctx.db))
  })

  api.get('/people/:id', access.administrator, async (req, res) => {
    res.json(await readPerson(ctx.db, pathId(req.params.id), ctx.now()))
  })

  api.put('/people/:id/assignments', access.administrator, jsonBody, async (req, res) => {
    const personId = pathId(req.params.id)
    const input = readInput(req.body, { clientIds: ids, projectIds: ids, state: shortText })
    await saveAssignments(ctx.db, { ...input, personId, actorId: requireSession(res).person.id, now: ctx.now() })
    res.json(await readPerson(ctx.db, personId, ctx.now()))
  })

  api.post('/people/:id/reset-link', access.administrator, async (req, res) => {
    res.status(201).json(await createResetLink(ctx, pathId(req.params.id), requireSession(res).person))
  })

  api.get('/help-requests', access.administrator, async (_req, res) => {
    res.json({ requests: await listHelpRequests(ctx.db) })
  })
}
