/** What the server's API sends about accounts and people. */
import type { personStatuses } from './domain'

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
  company: { name: string; timeZone: string }
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
  signIn: SignInState
  photoId: number | null
}

export interface PersonDetails extends PersonRow {
  timeZone: string
  clients: AssignmentClient[]
  /** Identifies the assignments as read; sent back when saving. */
  state: string
}

export interface RoleOption {
  id: number
  key: string
  name: string
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

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; retryAfterSeconds?: number }
}
