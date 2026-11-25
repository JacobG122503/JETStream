/**
 * What people may do: the permission catalogue, and lists of permissions. Pure; the server decides
 * (src/server/access), the web app shows. docs/permissions.md explains the rules in words, and a
 * test compares it with this file.
 */
import type { builtInRoleKeys } from './domain'

/** `managed`: for the projects and people someone manages. `all`: for everything. */
export const permissionLevels = ['managed', 'all'] as const
export type Level = (typeof permissionLevels)[number]

/** In the order in which they are shown. */
export const permissionAreas = [
  'Time', 'Expenses', 'Projects', 'Clients & Tasks', 'People', 'Rates', 'Invoices', 'Estimates', 'Reports', 'Approvals', 'Schedule & Time Off', 'Account',
] as const
export type PermissionArea = (typeof permissionAreas)[number]

export interface Permission<K extends string = string> {
  key: K
  area: PermissionArea
  /** Completes "can ...". */
  label: string
  /** What it allows. */
  allows: string
  /** Without `managed` it is company-wide. */
  levels: readonly Level[]
  /** Held at the same level as well. */
  needs: readonly K[]
  /** Whether the built-in Manager role has it, or can be given it for one person. */
  manager: 'yes' | 'extra' | 'no'
}

const both = ['managed', 'all'] as const
const companyWide = ['all'] as const

const catalogue = [
  { key: 'people.view', area: 'People', label: 'see the team list and person pages', allows: 'Team list and person pages (no rates)', levels: both, needs: [], manager: 'yes' },
  { key: 'people.manage', area: 'People', label: 'add, invite, edit and archive people, and assign them to clients and projects', allows: 'Add, invite, edit, archive people; requests, invites, reset links, sign-up switch; client and project assignment', levels: companyWide, needs: ['people.view'], manager: 'no' },
  { key: 'roles.manage', area: 'People', label: 'give roles and extras, and choose who manages what', allows: 'Roles, extras, managed people and projects (grant rule)', levels: companyWide, needs: ['people.view'], manager: 'no' },
  { key: 'clients.view', area: 'Clients & Tasks', label: 'see client pages and contacts', allows: 'Client pages and contacts (no amounts)', levels: both, needs: [], manager: 'yes' },
  { key: 'clients.manage', area: 'Clients & Tasks', label: 'create, edit and archive clients and contacts', allows: 'Create, edit, archive clients and contacts', levels: companyWide, needs: ['clients.view'], manager: 'no' },
  { key: 'projects.view', area: 'Projects', label: 'see project pages', allows: 'Project pages (no amounts)', levels: both, needs: [], manager: 'yes' },
  { key: 'projects.edit', area: 'Projects', label: 'edit, archive and delete projects, with their team, tasks and hour budgets', allows: 'Edit, archive, delete projects; team, tasks, hour budgets', levels: both, needs: ['projects.view'], manager: 'yes' },
  { key: 'projects.create', area: 'Projects', label: 'create projects and manage them', allows: 'Create projects (creator becomes its manager) for any active client, shown by name only, or a new client with name and currency', levels: companyWide, needs: [], manager: 'extra' },
  { key: 'tasks.manage', area: 'Clients & Tasks', label: 'manage the task library and expense categories', allows: 'Task library and expense categories', levels: companyWide, needs: [], manager: 'no' },
  { key: 'time.view', area: 'Time', label: "see others' time and expenses", allows: "Others' time and expenses", levels: both, needs: [], manager: 'yes' },
  { key: 'time.edit', area: 'Time', label: "enter, edit and delete others' time and expenses", allows: "Enter, edit, delete others' time and expenses", levels: both, needs: ['time.view'], manager: 'extra' },
  { key: 'time.approve', area: 'Approvals', label: 'approve, reject and withdraw approval of time and expenses', allows: 'Approve, reject, withdraw approval of time and expenses', levels: both, needs: ['time.view'], manager: 'extra' },
  { key: 'time.unlock', area: 'Time', label: 'unlock locked periods and entries', allows: 'Unlock locked periods and entries', levels: companyWide, needs: ['time.view'], manager: 'no' },
  { key: 'expenses.reimburse', area: 'Expenses', label: 'record reimbursement of expenses', allows: 'Record reimbursement', levels: companyWide, needs: ['time.view'], manager: 'no' },
  { key: 'billable.view', area: 'Rates', label: 'see billable rates, billable amounts and fee budgets', allows: 'Billable rates, billable amounts, fee budgets', levels: both, needs: [], manager: 'extra' },
  { key: 'billable.edit', area: 'Rates', label: 'edit billable rates and fee budgets', allows: 'Edit billable rates and fee budgets', levels: both, needs: ['billable.view'], manager: 'extra' },
  { key: 'cost.view', area: 'Rates', label: 'see cost rates, costs and margins', allows: 'Cost rates, costs, margins', levels: both, needs: [], manager: 'extra' },
  { key: 'cost.edit', area: 'Rates', label: 'edit cost rates', allows: 'Edit cost rates', levels: companyWide, needs: ['cost.view'], manager: 'no' },
  { key: 'invoices.manage', area: 'Invoices', label: 'create, edit, send and delete invoices', allows: 'Create, edit, send, delete invoices', levels: both, needs: ['billable.view', 'time.view', 'clients.view'], manager: 'extra' },
  { key: 'payments.manage', area: 'Invoices', label: 'record payments, refunds, write-offs and retainers', allows: 'Record payments, refunds, write-offs, retainers', levels: both, needs: ['invoices.manage'], manager: 'extra' },
  { key: 'estimates.manage', area: 'Estimates', label: 'create, edit, send and convert estimates', allows: 'Create, edit, send, convert estimates', levels: both, needs: ['billable.view', 'clients.view'], manager: 'extra' },
  { key: 'schedule.view', area: 'Schedule & Time Off', label: "see others' schedule", allows: "Others' schedule", levels: both, needs: [], manager: 'yes' },
  { key: 'schedule.edit', area: 'Schedule & Time Off', label: "plan others' schedule", allows: "Plan others' schedule", levels: both, needs: ['schedule.view'], manager: 'extra' },
  { key: 'timeoff.approve', area: 'Schedule & Time Off', label: 'decide time-off requests', allows: 'Decide time-off requests', levels: both, needs: ['people.view'], manager: 'extra' },
  { key: 'timeoff.manage', area: 'Schedule & Time Off', label: 'manage time-off policies, balances, holidays and work schedules', allows: 'Policies, balances, holidays, work schedules', levels: companyWide, needs: ['people.view'], manager: 'no' },
  { key: 'settings.manage', area: 'Account', label: 'change company settings and modules', allows: 'Company settings and modules', levels: companyWide, needs: [], manager: 'no' },
  { key: 'activity.view', area: 'Reports', label: 'see the activity log', allows: 'Activity log', levels: companyWide, needs: [], manager: 'no' },
  { key: 'outbox.view', area: 'Account', label: 'see the Outbox and message templates', allows: 'Outbox and message templates', levels: companyWide, needs: [], manager: 'no' },
] as const

export type PermissionKey = (typeof catalogue)[number]['key']
export type Catalogue<K extends string = PermissionKey> = readonly Permission<K>[]

/** In the order in which they are shown. The keys are stored and must not change. */
export const permissionCatalogue: Catalogue = catalogue

/** Only for the built-in Administrator; no permission gives these. */
export const administratorOnly = [
  'granting or removing the Administrator role',
  'import, full export, backup and restore',
  'reset of demo data',
  'webhooks and single sign-on settings',
] as const

/** Permissions with their level. What is not in it is not held. */
export type Grants<K extends string = PermissionKey> = Readonly<Partial<Record<K, Level>>>

const byKey: ReadonlyMap<string, Permission<PermissionKey>> = new Map(permissionCatalogue.map((permission) => [permission.key, permission]))

export const isPermissionKey = (key: unknown): key is PermissionKey => typeof key === 'string' && byKey.has(key)

export function permissionOf(key: PermissionKey): Permission<PermissionKey> {
  const found = byKey.get(key)
  if (!found) throw new Error(`There is no permission ${key}`)
  return found
}

export const isLevel = (value: unknown): value is Level => value === 'managed' || value === 'all'

/** Whether having the first is enough where the second is asked for. `all` includes `managed`. */
export const reaches = (have: Level | undefined, wanted: Level): boolean => have === 'all' || (have !== undefined && have === wanted)

const higher = (a: Level | undefined, b: Level): Level => (a === 'all' ? 'all' : b)

/** The level at which a permission is given with the built-in Manager role. */
const managerLevel = ({ levels }: Permission): Level => (levels.includes('managed') ? 'managed' : 'all')

/** Those of the list, in catalogue order. */
export const grantedKeys = (grants: Grants): PermissionKey[] =>
  permissionCatalogue.map(({ key }) => key).filter((key) => grants[key] !== undefined)

/** What of the second list is not in the first, at the same or a higher level. */
export function missingFrom(have: Grants, wanted: Grants): PermissionKey[] {
  return grantedKeys(wanted).filter((key) => !reaches(have[key], wanted[key] ?? 'managed'))
}

// Built-in roles -----------------------------------------------------------------------------------

export type BuiltInRole = (typeof builtInRoleKeys)[number]

export const builtInDescriptions: Record<BuiltInRole, string> = {
  member: 'Track time and expenses on assigned projects.',
  manager: 'Manage their projects. View time and expenses for their team. No access to rates, invoices, approvals or account settings unless switched on for the person.',
  people_admin: 'Manage people, and all time entries and expenses across the account. No access to rates, invoices, or account settings.',
  accounting: 'Manage invoices, payments, estimates and clients, and pay expenses back. View rates and reports. No access to people or account settings.',
  executive: 'Manage time, expenses, projects, people, invoices, and reports. View rates. No access to permissions or account settings.',
  administrator: 'Full access to account settings, billing, and all permissions.',
}

/** In the order in which they are offered. */
export const builtInOrder: readonly BuiltInRole[] = ['member', 'manager', 'people_admin', 'accounting', 'executive', 'administrator']

/** Everything. Always from the catalogue, so that new permissions are included. */
export function everything<K extends string = PermissionKey>(list: Catalogue<K> = permissionCatalogue as never): Grants<K> {
  return Object.fromEntries(list.map(({ key }) => [key, 'all'])) as Grants<K>
}

/** What can be switched on for one person with the built-in Manager role. */
export const managerExtras: readonly PermissionKey[] = permissionCatalogue.filter(({ manager }) => manager === 'extra').map(({ key }) => key)

/** What the built-in roles between Manager and Administrator give: exactly this, also when there are new permissions. */
export const profileGrants = {
  people_admin: {
    'people.view': 'all', 'people.manage': 'all', 'projects.view': 'all', 'clients.view': 'all', 'time.view': 'all', 'time.edit': 'all', 'time.approve': 'all',
    'time.unlock': 'all', 'schedule.view': 'all', 'schedule.edit': 'all', 'timeoff.approve': 'all', 'timeoff.manage': 'all',
  },
  accounting: {
    'clients.view': 'all', 'clients.manage': 'all', 'projects.view': 'all', 'time.view': 'all', 'expenses.reimburse': 'all', 'billable.view': 'all', 'cost.view': 'all',
    'invoices.manage': 'all', 'payments.manage': 'all', 'estimates.manage': 'all',
  },
  executive: {
    'people.view': 'all', 'people.manage': 'all', 'clients.view': 'all', 'clients.manage': 'all', 'projects.view': 'all', 'projects.edit': 'all', 'projects.create': 'all',
    'tasks.manage': 'all', 'time.view': 'all', 'time.edit': 'all', 'time.approve': 'all', 'time.unlock': 'all', 'expenses.reimburse': 'all', 'billable.view': 'all', 'cost.view': 'all',
    'invoices.manage': 'all', 'payments.manage': 'all', 'estimates.manage': 'all', 'schedule.view': 'all', 'schedule.edit': 'all', 'timeoff.approve': 'all', 'timeoff.manage': 'all',
    'activity.view': 'all',
  },
} as const satisfies Partial<Record<BuiltInRole, Grants>>

const isManagerExtra = (key: string): key is PermissionKey => managerExtras.some((extra) => extra === key)

/** The built-in Manager role with extras. What is not an extra gives nothing. */
export function managerGrants(extras: readonly string[] = []): Grants {
  const chosen = permissionCatalogue.filter(({ key, manager }) => manager === 'yes' || (manager === 'extra' && extras.includes(key)))
  return Object.fromEntries(chosen.map((permission) => [permission.key, managerLevel(permission)])) as Grants
}

export interface RoleLike {
  key: string | null
  builtIn: boolean
  /** As stored; anything may be in it. */
  permissions: unknown
}

/** What a role gives, with the extras of one person, which count for the built-in Manager only. */
export function roleGrants<K extends string = PermissionKey>(
  role: RoleLike, extras: readonly string[] = [], list: Catalogue<K> = permissionCatalogue as never,
): Grants<K> {
  if (!role.builtIn) return readGrants(role.permissions, list)
  if (role.key === 'administrator') return everything(list)
  if (role.key === 'manager') return managerGrants(extras) as Grants<K>
  return (Object.hasOwn(profileGrants, role.key ?? '') ? profileGrants[role.key as keyof typeof profileGrants] : {}) as Grants<K>
}

/**
 * What someone holds: their own list where one was made for them, and otherwise what their role gives.
 * Administrators hold everything, whatever is stored.
 */
export function personGrants(role: RoleLike, extras: readonly string[], own: unknown): Grants {
  return own === null || own === undefined || isAdministratorRole(role) ? roleGrants(role, extras) : readGrants(own)
}

/** The extras that give exactly this list with the built-in Manager role, or null. */
export function asManagerExtras(grants: Grants): PermissionKey[] | null {
  const extras = managerExtras.filter((key) => grants[key] !== undefined)
  return sameGrants(managerGrants(extras), grants) ? extras : null
}

export const sameGrants = (a: Grants, b: Grants): boolean => permissionCatalogue.every(({ key }) => a[key] === b[key])

export const isAdministratorRole = ({ key, builtIn }: Pick<RoleLike, 'key' | 'builtIn'>): boolean => builtIn && key === 'administrator'

// Stored and sent lists ----------------------------------------------------------------------------

/** As stored with a role: `key:level`. */
export const writeGrants = (grants: Grants): string[] => grantedKeys(grants).map((key) => `${key}:${grants[key]}`)

/** A stored list. What the catalogue does not know gives nothing. */
export function readGrants<K extends string = PermissionKey>(
  stored: unknown, list: Catalogue<K> = permissionCatalogue as never,
): Grants<K> {
  const found: Partial<Record<K, Level>> = {}
  for (const item of Array.isArray(stored) ? (stored as unknown[]) : []) {
    if (typeof item !== 'string') continue
    const [key, level, ...rest] = item.split(':')
    const permission = list.find((candidate) => candidate.key === key)
    if (!permission || rest.length > 0 || !isLevel(level) || !permission.levels.includes(level)) continue
    found[permission.key] = higher(found[permission.key], level)
  }
  return found
}

/** What is wrong with a list that someone sent, in words; null for a good one. */
export function problemWith(sent: unknown): string | null {
  if (typeof sent !== 'object' || sent === null || Array.isArray(sent)) return 'Choose permissions from the list.'
  for (const [key, level] of Object.entries(sent)) {
    if (!isPermissionKey(key)) return 'There is no such permission.'
    if (!isLevel(level) || !permissionOf(key).levels.includes(level)) return `"${permissionOf(key).allows}" cannot be given at this level.`
  }
  const grants = sent as Grants
  for (const key of grantedKeys(grants)) {
    const missing = missingNeeds(grants, key)[0]
    if (missing) return `"${permissionOf(key).allows}" needs "${permissionOf(missing).allows}" at the same level.`
  }
  return null
}

function missingNeeds(grants: Grants, key: PermissionKey): PermissionKey[] {
  const level = grants[key]
  return level === undefined ? [] : permissionOf(key).needs.filter((need) => !reaches(grants[need], level))
}

/** What is wrong with the extras someone chose; null for good ones. */
export function problemWithExtras(extras: readonly string[]): string | null {
  if (!extras.every(isManagerExtra)) return 'Choose extras from the list.'
  const grants = managerGrants(extras)
  for (const key of grantedKeys(grants)) {
    const missing = missingNeeds(grants, key)[0]
    if (missing) return `"${permissionOf(key).allows}" needs "${permissionOf(missing).allows}".`
  }
  return null
}

// Choosing -----------------------------------------------------------------------------------------

export interface GrantChange {
  grants: Grants
  /** What changed besides what was chosen. */
  added: PermissionKey[]
  removed: PermissionKey[]
}

/**
 * Sets one permission. What it needs is added at the same level; what depends on it is taken away,
 * or lowered to the level that is left.
 */
export function chooseLevel(before: Grants, key: PermissionKey, level: Level | null): GrantChange {
  const next: Partial<Record<PermissionKey, Level>> = { ...before }
  const added = new Set<PermissionKey>()
  const removed = new Set<PermissionKey>()
  if (level === null) delete next[key]
  else next[key] = level

  const raise = (from: PermissionKey) => {
    for (const need of missingNeeds(next, from)) {
      next[need] = next[from]
      added.add(need)
      raise(need)
    }
  }
  if (level !== null) raise(key)

  for (let changed = true; changed; ) {
    changed = false
    for (const dependent of grantedKeys(next)) {
      if (missingNeeds(next, dependent).length === 0) continue
      const lower = next[dependent] === 'all' && permissionOf(dependent).levels.includes('managed')
      if (lower && permissionOf(dependent).needs.every((need) => next[need] !== undefined)) next[dependent] = 'managed'
      else delete next[dependent]
      removed.add(dependent)
      changed = true
    }
  }
  return { grants: next, added: [...added], removed: [...removed] }
}

export interface ExtrasChange {
  extras: PermissionKey[]
  added: PermissionKey[]
  removed: PermissionKey[]
}

/** The same for the extras of a person with the built-in Manager role. */
export function chooseExtra(extras: readonly PermissionKey[], key: PermissionKey, on: boolean): ExtrasChange {
  const level = managerLevel(permissionOf(key))
  const { grants, added, removed } = chooseLevel(managerGrants(extras), key, on ? level : null)
  return { extras: managerExtras.filter((extra) => grants[extra] !== undefined), added, removed }
}

// Words --------------------------------------------------------------------------------------------

/** What every active person can do, whatever their role. */
/** The same by area, to be shown among the permissions. */
export const baseByArea: Partial<Record<PermissionArea, string>> = {
  Time: 'Track their own time',
  Expenses: 'Track their own expenses',
  Projects: 'See the projects they are on',
  Reports: 'See their own hours in reports',
  'Schedule & Time Off': 'See their own schedule and time off',
  Account: 'Manage their own account',
}

/** One thing to tick: a permission at a level. */
export interface PermissionChoice {
  key: PermissionKey
  level: Level
  label: string
}

/** Everything that can be ticked in an area. */
export const choicesOf = (area: PermissionArea): PermissionChoice[] =>
  permissionCatalogue
    .filter((permission) => permission.area === area)
    .flatMap(({ key, allows, levels }) =>
      levels.map((level) => ({ key, level, label: levels.length === 1 ? allows : `${allows} (${level === 'all' ? 'everything' : 'only what they manage'})` })),
    )

/** How many of an area, or of all, are ticked. What everyone has counts too. */
export function countChoices(grants: Grants, areas: readonly PermissionArea[] = permissionAreas): { on: number; of: number } {
  const choices = areas.flatMap(choicesOf)
  const base = areas.filter((area) => baseByArea[area] !== undefined).length
  return { on: base + choices.filter(({ key, level }) => reaches(grants[key], level)).length, of: base + choices.length }
}

export const baseAccess =
  'their own account, time, expenses, time off and schedule, their own hours in reports, and the projects they are on'

/** What changes between two lists, with the level that is gained or lost. */
export function compareGrants(before: Grants, after: Grants): { gained: Grants; lost: Grants } {
  const changed = (from: Grants, to: Grants) =>
    Object.fromEntries(missingFrom(from, to).map((key) => [key, to[key]])) as Grants
  return { gained: changed(before, after), lost: changed(after, before) }
}

/** "see project pages (managed)". Company-wide permissions have no level to tell. */
export function describePermission(key: PermissionKey, level: Level): string {
  const { label, levels } = permissionOf(key)
  if (levels.length === 1) return label
  return `${label} (${level === 'all' ? 'all' : 'managed'})`
}
