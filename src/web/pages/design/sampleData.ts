import { addDays, type ComboboxOption } from '../../ui'

/** Made-up data for the gallery. The people, companies and figures are fictional. */
const clientProjects: Record<string, string[]> = {
  'Acme Fabrication': ['Conveyor retrofit', 'Press line controls', 'Plant air survey'],
  'Northline Utilities': ['Substation relay upgrade', 'Pump station telemetry', 'Metering pilot'],
  'Harlow Foods': ['Cold store panels', 'Packaging line 3'],
}

export const projectOptions: ComboboxOption[] = Object.entries(clientProjects).flatMap(([group, projects]) =>
  projects.map((label) => ({ value: `${group}/${label}`, label, group, disabled: label === 'Metering pilot' })),
)

export const manyOptions: ComboboxOption[] = Array.from({ length: 500 }, (_, index) => ({
  value: `work-order-${index + 1}`,
  label: `Work order ${String(index + 1).padStart(3, '0')}`,
  group: `Sample client ${Math.floor(index / 50) + 1}`,
}))

export interface SampleEntry {
  id: string
  date: string
  person: string
  project: string
  client: string
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected'
  /** Null where nothing was entered. */
  hours: number | null
}

const people = ['Dana Whitfield', 'Marcus Oyelaran', 'Priya Raman', 'Tom Beckett', 'Lucia Ferrante', 'Wen Zhao']
const statuses = ['Draft', 'Submitted', 'Approved', 'Approved', 'Rejected'] as const
const hours = [2, 10, 9, null, 7.5, 4.25, 8, 6, 1.5, 3]

const pick = <T>(list: readonly T[], index: number): T => list[index % list.length] as T

export const sampleEntries: SampleEntry[] = Array.from({ length: 60 }, (_, index) => {
  const project = pick(projectOptions, index * 3)
  return {
    id: `entry-${index + 1}`,
    date: addDays('2026-11-23', -Math.floor(index / 2)),
    person: pick(people, index * 5),
    project: project.label,
    client: project.group ?? '',
    status: pick(statuses, index),
    hours: pick(hours, index),
  }
})

export const longName =
  'Reinforcedconcretesubstationfoundationandcabletrenchrehabilitationprogrammephasetwoincludingtemporaryworksandcommissioning'.padEnd(120, 'x').slice(0, 120)
