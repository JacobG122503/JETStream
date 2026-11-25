/** What the server's API sends about accounts and people. */
import type { Weekday } from './dates'
import type { Formats } from './work'
import type { personStatuses } from './domain'
import type { Grants, PermissionKey } from './permissions'

export type PersonStatus = (typeof personStatuses)[number]

export interface RoleInfo {
  /** Null for roles made by an administrator. */
  key: string | null
  name: string
}

export interface SessionPerson {
  id: number
  name: string
  email: string
  status: PersonStatus
  role: RoleInfo
  administrator: boolean
  /** What the person may do now; empty while they wait for approval. */
  permissions: Grants
  /** Changes whenever the person may do something else, or on something else. */
  access: string
  /** IANA name; the company's where the person chose none. */
  timeZone: string
  photoId: number | null
}

export interface DemoAccount {
  key: string
  label: string
  name: string
}

export interface SessionInfo {
  company: { name: string; timeZone: string; weekStartsOn: Weekday; formats: Formats }
  person: SessionPerson | null
  /** To be sent with every request that changes something. Only while signed in. */
  csrfToken: string | null
  /** The rest is for pages shown while signed out. */
  signUpOpen: boolean
  /** Whether messages reach people, or an administrator has to hand over links. */
  emailDelivers: boolean
  /** Only in demo mode. */
  demoAccounts: DemoAccount[]
}

export interface Account {
  name: string
  email: string
  role: string
  timeZone: string
  photoId: number | null
  version: number
}

export interface SignedInDevice {
  id: number
  browser: string
  system: string
  signedInAt: string
  lastUsedAt: string
  current: boolean
}

export interface AssignmentProject {
  id: number
  name: string
  code: string
  archived: boolean
  assigned: boolean
}

export interface AssignmentClient {
  id: number
  name: string
  archived: boolean
  assigned: boolean
  projects: AssignmentProject[]
}

export type SignInState = 'password' | 'invited' | 'none'

export interface PersonRow {
  id: number
  name: string
  email: string
  role: string
  status: PersonStatus
  /** Only for those who manage people. */
  signIn?: SignInState
  photoId: number | null
}

export interface PersonDetails extends PersonRow {
  timeZone: string
  /** The rest only for those who manage people. */
  clients?: AssignmentClient[]
  /** Identifies the assignments as read; sent back when saving. */
  state?: string
  /** Why one may not act on the account, such as making a reset link; null when one may. */
  accountRefusal?: string | null
}

export interface SavedAssignments extends PersonDetails {
  /** Projects the person is on again, but does not manage again, although they did before. */
  notManaged: string[]
}

export interface RoleOption {
  id: number
  key: string | null
  name: string
  /** Whether the one who asks may give it. */
  allowed: boolean
}

/** What can be chosen when approving or inviting. */
export interface PeopleOptions {
  roles: RoleOption[]
  clients: AssignmentClient[]
}

export interface JoinRequest {
  id: number
  name: string
  email: string
  requestedAt: string
}

export interface JoinRequests {
  enabled: boolean
  requests: JoinRequest[]
}

export type InviteStatus = 'open' | 'expired' | 'void' | 'accepted' | 'revoked'

export interface InviteRow {
  id: number
  name: string
  email: string
  role: string
  status: InviteStatus
  invitedBy: string
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
}

export interface NewLink {
  /** Shown once; the server keeps only a hash of it. */
  link: string
  expiresAt: string
  /** Whether it was also sent by email. */
  emailed: boolean
}

export interface HelpRequest {
  id: number
  personId: number
  name: string
  email: string
  requestedAt: string
  hasPassword: boolean
}

export interface InviteInfo {
  company: string
  companyTimeZone: string
  name: string
  email: string
  role: string
}

/** What someone may do, and what they manage. */
export interface AccessInfo {
  role: RoleInfo
  administrator: boolean
  grants: Grants
  managedProjects: string[]
  managedPeople: string[]
}

export interface RoleSummary {
  id: number
  /** Identifies a built-in role; null for the others. */
  key: string | null
  builtIn: boolean
  name: string
  description: string
  /** Everyone who holds it, archived people too. */
  people: number
}

export interface RoleDetails extends RoleSummary {
  grants: Grants
  version: number
  /** Invites that can still be used, or get a new link. */
  invites: number
  /** Why one may not change or delete it; null when one may. */
  refusal: string | null
}

/** A role that could be given to someone. */
export interface RoleChoice {
  id: number
  key: string | null
  name: string
  description: string
  builtIn: boolean
  grants: Grants
  /** Why one may not give it; null when one may. */
  refusal: string | null
}

export interface AccessProject {
  id: number
  name: string
  client: string
  archived: boolean
  isManager: boolean
}

export interface AccessPerson {
  id: number
  name: string
  active: boolean
}

/** Someone's access, for those who may change access. */
export interface PersonAccessDetails {
  /** Identifies the access as read; sent back when saving. */
  state: string
  /** `flags`: only which projects the person manages. */
  editable: 'all' | 'flags' | 'none'
  /** Why not everything can be changed. */
  reason: string | null
  roleId: number
  extras: PermissionKey[]
  /** A list of their own, in place of what the role gives; null without one. */
  permissions: Grants | null
  /** What the one who asks holds; more cannot be given. */
  held: Grants
  /** Extras one may not give or take. */
  refusedExtras: PermissionKey[]
  managedPeople: AccessPerson[]
  projects: AccessProject[]
  roles: RoleChoice[]
  /** Who can be chosen as a managed person. */
  people: AccessPerson[]
}

export interface AccessInput {
  roleId: number
  extras: PermissionKey[]
  permissions: Grants | null
  managedPersonIds: number[]
  managedProjectIds: number[]
  state: string
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; retryAfterSeconds?: number }
}
