import { useState } from 'react'
import type { AssignmentClient, AssignmentProject } from '../../../shared/api'
import { Badge, Checkbox, EmptyState, SearchField } from '../../ui'
import { allProjectsState, type Choice, toggleClient, toggleProjects } from './assignmentChoice'

const searchFrom = 8

interface AssignmentPickerProps {
  clients: AssignmentClient[]
  value: Choice
  onChange: (value: Choice) => void
  disabled?: boolean
}

const projectLabel = ({ code, name }: AssignmentProject) => (code ? `${name} (${code})` : name)

/** Client companies and, under each, their projects. */
export function AssignmentPicker({ clients, value, onChange, disabled }: AssignmentPickerProps) {
  const [search, setSearch] = useState('')
  const wanted = search.trim().toLowerCase()
  const shown = clients.filter(
    ({ name, projects }) =>
      name.toLowerCase().includes(wanted) || projects.some((project) => projectLabel(project).toLowerCase().includes(wanted)),
  )
  if (clients.length === 0) {
    return <EmptyState icon="clients" title="No clients yet" description="Once there are client companies, they can be chosen here." />
  }
  return (
    <div className="stack">
      {clients.length >= searchFrom && <SearchField label="Search clients and projects" value={search} onChange={setSearch} />}
      {shown.length === 0 && <p className="assignment-none">No matches</p>}
      <div className="assignment-list" role="group" aria-label="Client companies and projects">
        {shown.map((client) => (
          <ClientChoice key={client.id} client={client} value={value} onChange={onChange} disabled={disabled} />
        ))}
      </div>
    </div>
  )
}

function ClientChoice({ client, value, onChange, disabled }: Omit<AssignmentPickerProps, 'clients'> & { client: AssignmentClient }) {
  const chosen = value.clientIds.includes(client.id)
  const open = client.projects.filter(({ archived }) => !archived)
  const closed = client.projects.filter(({ archived }) => archived)
  const all = allProjectsState(value, client)
  return (
    <div className="assignment-client" role="group" aria-label={client.name}>
      <Checkbox
        label={client.archived ? `${client.name} (archived)` : client.name}
        checked={chosen || client.archived}
        disabled={disabled || client.archived}
        onChange={(on) => onChange(toggleClient(value, client, on))}
      />
      {client.projects.length === 0 ? (
        <p className="assignment-none">No projects</p>
      ) : (
        <div className="assignment-projects">
          {open.length > 1 && (
            <Checkbox
              label={`All projects of ${client.name}`}
              checked={all === 'all'}
              indeterminate={all === 'some'}
              disabled={disabled}
              onChange={() => onChange(toggleProjects(value, client, open.map(({ id }) => id), all !== 'all'))}
            />
          )}
          {open.map((project) => (
            <Checkbox
              key={project.id}
              label={projectLabel(project)}
              checked={value.projectIds.includes(project.id)}
              disabled={disabled}
              onChange={(on) => onChange(toggleProjects(value, client, [project.id], on))}
            />
          ))}
          {closed.map((project) => (
            <p key={project.id} className="assignment-none">
              {projectLabel(project)} <Badge>Archived, stays assigned</Badge>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
