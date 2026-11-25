import type { Router } from 'express'
import type { Access } from '../../auth/access'
import type { AppContext } from '../../context'

export type AddRoutes = (api: Router, access: Access, ctx: AppContext) => void
