/** Work that no person does. Not for routes: lint refuses this import there. */
import { SystemActor } from './actor'

/** Someone who may do everything, for unattended work and commands on the server. The name says which. */
export const systemActor = (name: string): SystemActor => new SystemActor(name)
