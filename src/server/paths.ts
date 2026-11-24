import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Two levels up is the project folder both here (src/server) and in the bundle (dist/server).
export const projectRoot = fileURLToPath(new URL('../..', import.meta.url))

export const migrationsDir = join(projectRoot, 'drizzle')
export const webBuildDir = join(projectRoot, 'dist', 'web')
/** Embedded databases; git-ignored. */
export const dataRoot = join(projectRoot, '.data')
