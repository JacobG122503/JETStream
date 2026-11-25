import { useState } from 'react'
import type { PeopleOptions } from '../../../shared/api'
import { type Load, useLoad } from '../../auth/useLoad'
import { type Choice, noChoice } from './assignmentChoice'

export interface Access extends Choice {
  roleId: string
}

/** What is chosen for someone new: Member, without assignments, unless changed. */
export function useAccess(): { load: Load<PeopleOptions>; access: Access; setAccess: (access: Access) => void } {
  const load = useLoad<PeopleOptions>('people/options')
  const [chosen, setChosen] = useState<Access>({ roleId: '', ...noChoice })
  const member = load.data?.roles.find(({ key }) => key === 'member')
  return { load, access: { ...chosen, roleId: chosen.roleId || String(member?.id ?? '') }, setAccess: setChosen }
}

/** As the API takes it. */
export const accessBody = ({ roleId, clientIds, projectIds }: Access) => ({ roleId: Number(roleId), clientIds, projectIds })
