import { useState } from 'react'
import { Combobox, DatePicker, DateRangePicker, MultiCombobox, Select, type Weekday } from '../../ui'
import { Example, Section } from './Section'
import { manyOptions, projectOptions } from './sampleData'

export function ComboboxSection() {
  const [project, setProject] = useState<string | null>(null)
  const [projects, setProjects] = useState<string[]>([projectOptions[0]?.value ?? ''])
  const [order, setOrder] = useState<string | null>(null)
  const chosen = projectOptions.find((option) => option.value === project)
  return (
    <Section id="combobox" title="Combobox">
      <Example title="One choice, grouped by client" layout="grid" note="Finds projects by their own or their client's name.">
        <Combobox label="Project" placeholder="Choose a project" options={projectOptions} value={project} onChange={setProject} hint={chosen ? `${chosen.group}: ${chosen.label}` : 'Nothing chosen'} />
        <Combobox label="One of 500 work orders" options={manyOptions} value={order} onChange={setOrder} />
      </Example>
      <Example title="Several choices" layout="grid">
        <MultiCombobox label="Projects" placeholder="Add a project" options={projectOptions} value={projects} onChange={setProjects} />
      </Example>
      <Example title="States" layout="grid">
        <Combobox label="Project with an error" options={projectOptions} required error="Choose a project" value={null} onChange={() => undefined} />
        <Combobox label="Read-only project" options={projectOptions} readOnly value={projectOptions[1]?.value ?? null} onChange={() => undefined} />
        <Combobox label="Disabled project" options={projectOptions} disabled value={null} onChange={() => undefined} />
      </Example>
    </Section>
  )
}

export function DatesSection() {
  const [date, setDate] = useState('2026-11-23')
  const [limited, setLimited] = useState('')
  const [range, setRange] = useState({ start: '2026-11-01', end: '2026-11-30' })
  const [weekStart, setWeekStart] = useState<Weekday>(1)
  return (
    <Section id="dates" title="Dates">
      <Example title="Date" layout="grid">
        <DatePicker label="Work date" hint="Type 11/23/2026 or 2026-11-23" value={date} onChange={setDate} weekStart={weekStart} />
        <DatePicker label="Day in November 2026" min="2026-11-01" max="2026-11-30" value={limited} onChange={setLimited} today="2026-11-23" weekStart={weekStart} />
        <Select
          label="Week starts on"
          options={[
            { value: '1', label: 'Monday' },
            { value: '0', label: 'Sunday' },
          ]}
          value={String(weekStart)}
          onChange={(value) => setWeekStart(Number(value) as Weekday)}
        />
      </Example>
      <p className="gallery-note">
        Value: <code data-testid="date-value">{date || 'empty'}</code>
      </p>
      <Example title="Date states" layout="grid">
        <DatePicker label="Invoice date" required error="Choose the invoice date" value="" onChange={() => undefined} />
        <DatePicker label="Read-only date" readOnly value="2026-11-23" onChange={() => undefined} />
        <DatePicker label="Disabled date" disabled value="" onChange={() => undefined} />
      </Example>
      <Example title="Date range" layout="block">
        <DateRangePicker label="Report dates" value={range} onChange={setRange} today="2026-11-23" weekStart={weekStart} />
        <p className="gallery-note">
          Value: <code data-testid="range-value">{range.start === '' ? 'empty' : `${range.start} to ${range.end}`}</code>
        </p>
      </Example>
    </Section>
  )
}
