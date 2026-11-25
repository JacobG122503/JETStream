import express from 'express'
import { photoLimits } from '../../../shared/accounts'
import { requireSession } from '../../auth/access'
import { clearSessionCookie, endSessions } from '../../auth/sessions'
import { openSession, readSessionInfo } from '../../auth/signIn'
import { ApiError } from '../../errors'
import { endDevice, listDevices, readAccount, readPhoto, removePhoto, savePhoto, saveProfile } from '../../people/account'
import { changePassword } from '../../people/resets'
import { bodyReader, jsonBody } from '../body'
import { password, pathId, personName, readInput, timeZone, version } from '../input'
import type { AddRoutes } from './types'

// Whatever type it claims to be: the content decides.
const photoBody = bodyReader(express.raw({ type: () => true, limit: photoLimits.bytes }))

/** One's own account. */
export const accountRoutes: AddRoutes = (api, access, ctx) => {
  api.get('/account', access.signedIn, async (_req, res) => {
    res.json(await readAccount(ctx.db, requireSession(res).person.id))
  })

  api.put('/account/profile', access.signedIn, jsonBody, async (req, res) => {
    const { person } = requireSession(res)
    await saveProfile(ctx.db, person.id, readInput(req.body, { name: personName, timeZone, version }))
    res.json(await readAccount(ctx.db, person.id))
  })

  api.put('/account/photo', access.signedIn, photoBody, async (req, res) => {
    const { person } = requireSession(res)
    const upload: unknown = req.body
    if (!Buffer.isBuffer(upload) || upload.length === 0) throw new ApiError(400, 'bad_image', 'Choose a picture.')
    await savePhoto(ctx.db, person.id, upload)
    res.json(await readAccount(ctx.db, person.id))
  })

  api.delete('/account/photo', access.signedIn, async (_req, res) => {
    const { person } = requireSession(res)
    await removePhoto(ctx.db, person.id)
    res.json(await readAccount(ctx.db, person.id))
  })

  api.get('/photos/:id', access.signedIn, async (req, res) => {
    const { mediaType, content } = await readPhoto(ctx.db, pathId(req.params.id))
    res.set('Content-Type', mediaType).set('Content-Disposition', 'inline').send(content)
  })

  api.post('/account/password', access.signedIn, jsonBody, async (req, res) => {
    const input = readInput(req.body, { currentPassword: password, newPassword: password })
    const renewed = await changePassword(ctx, requireSession(res), input)
    openSession(ctx, req, res, renewed)
    res.json(await readSessionInfo(ctx, req))
  })

  api.get('/account/sessions', access.signedIn, async (_req, res) => {
    res.json({ sessions: await listDevices(ctx.db, requireSession(res), ctx.now()) })
  })

  api.post('/account/sessions/end-others', access.signedIn, async (_req, res) => {
    const session = requireSession(res)
    await endSessions(ctx.db, session.person.id, session.id)
    res.json({ sessions: await listDevices(ctx.db, session, ctx.now()) })
  })

  api.delete('/account/sessions/:id', access.signedIn, async (req, res) => {
    const session = requireSession(res)
    const id = pathId(req.params.id)
    await endDevice(ctx.db, session.person.id, id)
    if (id === session.id) {
      clearSessionCookie(ctx, res)
      res.json({ sessions: [] })
      return
    }
    res.json({ sessions: await listDevices(ctx.db, session, ctx.now()) })
  })
}
