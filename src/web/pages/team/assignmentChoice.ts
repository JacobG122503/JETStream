import type { AssignmentClient } from '../../../shared/api'

export interface Choice {
  clientIds: number[]
  projectIds: number[]
}

export const noChoice: Choice = { clientIds: [], projectIds: [] }

/** What is assigned now and can be changed. Archived clients and projects cannot. */
export function choiceOf(clients: AssignmentClient[]): Choice {
  const current = clients.filter(({ archived }) => !archived)
  return {
    clientIds: current.filter(({ assigned }) => assigned).map(({ id }) => id),
    projectIds: current
      .flatMap(({ projects }) => projects)
      .filter(({ assigned, archived }) => assigned && !archived)
      .map(({ id }) => id),
  }
}

const currentProjects = (client: AssignmentClient) => client.projects.filter(({ archived }) => !archived)

export function toggleClient(choice: Choice, client: AssignmentClient, on: boolean): Choice {
  const own = new Set(client.projects.map(({ id }) => id))
  return {
    clientIds: on ? [...choice.clientIds, client.id] : choice.clientIds.filter((id) => id !== client.id),
    // Choosing a client chooses no project; leaving it out leaves out its projects.
    projectIds: on ? choice.projectIds : choice.projectIds.filter((id) => !own.has(id)),
  }
}

export function toggleProjects(choice: Choice, client: AssignmentClient, projectIds: number[], on: boolean): Choice {
  const changed = new Set(projectIds)
  const rest = choice.projectIds.filter((id) => !changed.has(id))
  return {
    // Choosing a project chooses its client.
    clientIds: on && !choice.clientIds.includes(client.id) ? [...choice.clientIds, client.id] : choice.clientIds,
    projectIds: on ? [...rest, ...projectIds] : rest,
  }
}

export function allProjectsState(choice: Choice, client: AssignmentClient): 'none' | 'some' | 'all' {
  const projects = currentProjects(client)
  const count = projects.filter(({ id }) => choice.projectIds.includes(id)).length
  return count === 0 ? 'none' : count === projects.length ? 'all' : 'some'
}

/** Clients that would be taken away, with the projects that go with them. */
export function removedClients(clients: AssignmentClient[], choice: Choice) {
  return clients
    .filter(({ id, archived, assigned }) => assigned && !archived && !choice.clientIds.includes(id))
    .map(({ name, projects }) => ({ name, projects: projects.filter(({ assigned }) => assigned).map((project) => project.name) }))
}
