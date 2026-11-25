import type { AccessProject, PersonAccessDetails } from '../../../shared/api'
import { baseAccess, describePermission, grantedKeys, type Grants, type PermissionKey, roleGrants } from '../../../shared/permissions'

/** What the chosen role and extras give. */
export function chosenGrants({ roles }: Pick<PersonAccessDetails, 'roles'>, roleId: number, extras: readonly PermissionKey[]): Grants {
  const role = roles.find(({ id }) => id === roleId)
  if (!role) return {}
  return role.builtIn && role.key === 'manager' ? roleGrants({ key: role.key, builtIn: true, permissions: [] }, extras) : role.grants
}

export const hasManaged = (grants: Grants) => grantedKeys(grants).some((key) => grants[key] === 'managed')

const list = (names: readonly string[]) => (names.length === 0 ? 'none' : names.join(', '))

/** What someone can do, line by line. */
export function accessLines(access: { administrator: boolean; grants: Grants; projects: readonly string[]; people: readonly string[] }): string[] {
  if (access.administrator) return ['Can do everything.']
  const lines = [`Can always use ${baseAccess}.`]
  lines.push(...grantedKeys(access.grants).map((key) => `Can ${describePermission(key, access.grants[key] ?? 'managed')}.`))
  if (hasManaged(access.grants)) {
    lines.push(`Manages these projects: ${list(access.projects)}.`, `Manages these people: ${list(access.people)}.`)
  } else if (access.projects.length + access.people.length > 0) {
    lines.push('What they manage has no effect with this role.')
  }
  return lines
}

export const projectLabel = ({ name, client, archived }: AccessProject) => `${name} (${client}${archived ? ', archived' : ''})`
