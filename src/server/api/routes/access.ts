import { requireActor } from '../../auth/access'
import { readAccessOf, saveAccess } from '../../people/access'
import { createRole, deleteRole, listRoles, readRole, updateRole } from '../../people/roles'
import { jsonBody } from '../body'
import { extras, grants, id, ids, optionalId, pathId, readInput, roleDescription, roleName, shortText, version } from '../input'
import type { AddRoutes } from './types'

/** Roles, and what each person may do. */
export const accessRoutes: AddRoutes = (api, access, ctx) => {
  api.get('/roles', access.permission('roles.manage'), async (_req, res) => {
    res.json({ roles: await listRoles(ctx.db, requireActor(res)) })
  })

  api.get('/roles/:id', access.permission('roles.manage'), async (req, res) => {
    res.json(await readRole(ctx.db, requireActor(res), pathId(req.params.id), ctx.now()))
  })

  api.post('/roles', access.permission('roles.manage'), jsonBody, async (req, res) => {
    const actor = requireActor(res)
    const roleId = await createRole(ctx, actor, readInput(req.body, { name: roleName, description: roleDescription, grants }))
    res.status(201).json(await readRole(ctx.db, actor, roleId, ctx.now()))
  })

  api.put('/roles/:id', access.permission('roles.manage'), jsonBody, async (req, res) => {
    const actor = requireActor(res)
    const roleId = pathId(req.params.id)
    await updateRole(ctx, actor, roleId, readInput(req.body, { name: roleName, description: roleDescription, grants, version }))
    res.json(await readRole(ctx.db, actor, roleId, ctx.now()))
  })

  api.post('/roles/:id/delete', access.permission('roles.manage'), jsonBody, async (req, res) => {
    const actor = requireActor(res)
    await deleteRole(ctx, actor, pathId(req.params.id), readInput(req.body, { version, replacementId: optionalId }))
    res.json({ roles: await listRoles(ctx.db, actor) })
  })

  api.get('/people/:id/access', access.permission('roles.manage'), async (req, res) => {
    res.json(await readAccessOf(ctx.db, requireActor(res), pathId(req.params.id)))
  })

  api.put('/people/:id/access', access.permission('roles.manage'), jsonBody, async (req, res) => {
    const actor = requireActor(res)
    const personId = pathId(req.params.id)
    const input = readInput(req.body, { roleId: id, extras, managedPersonIds: ids, managedProjectIds: ids, state: shortText })
    await saveAccess(ctx, actor, personId, input)
    res.json(await readAccessOf(ctx.db, actor, personId))
  })
}
