import { Icon, type IconName } from '../../ui'
import { Example, Section } from './Section'

const colours = [
  ['Brand', '--c-brand'],
  ['Accent', '--c-accent'],
  ['Accent, soft', '--c-accent-soft'],
  ['Background', '--c-bg'],
  ['Surface', '--c-surface'],
  ['Surface 2', '--c-surface-2'],
  ['Surface 3', '--c-surface-3'],
  ['Border', '--c-border'],
  ['Field border', '--c-border-strong'],
  ['Text', '--c-text'],
  ['Text, muted', '--c-text-muted'],
  ['Navigation', '--c-nav-bg'],
  ['Success', '--c-success'],
  ['Warning', '--c-warning'],
  ['Danger', '--c-danger'],
  ['Information', '--c-info'],
] as const

const spaces = ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16']

const icons: IconName[] = [
  'time', 'expenses', 'projects', 'clients', 'team', 'schedule', 'timeOff', 'reports', 'invoices', 'estimates', 'settings', 'search',
  'calendar', 'plus', 'edit', 'copy', 'trash', 'more', 'check', 'close', 'success', 'info', 'warning', 'error', 'refresh', 'lock', 'inbox',
  'compass', 'dollar', 'sun', 'moon', 'monitor',
]

export function FoundationsSection() {
  return (
    <Section id="foundations" title="Foundations">
      <Example title="Colour" layout="block" note="Tokens from styles/tokens.css. Each has a light and a dark value, except the brand colour.">
        <ul className="swatches">
          {colours.map(([name, token]) => (
            <li key={token} className="swatch">
              <span className="swatch-colour" style={{ background: `var(${token})` }} />
              <span className="swatch-name">{name}</span>
              <code className="swatch-token">{token}</code>
            </li>
          ))}
        </ul>
      </Example>
      <Example title="Type" layout="block">
        <p className="type-title">Page title, set wide</p>
        <p className="type-xl">Dialog and section titles</p>
        <p className="type-lg">Card titles</p>
        <p>Text. Hours line up: 1,284.50 and 97.25.</p>
        <p className="type-sm">Hints and table headers</p>
        <p className="type-xs">Badges</p>
      </Example>
      <Example title="Spacing" layout="block">
        <ul className="spaces">
          {spaces.map((space) => (
            <li key={space}>
              <code>{`--space-${space}`}</code>
              <span className="space-bar" style={{ width: `var(--space-${space})` }} />
            </li>
          ))}
        </ul>
      </Example>
      <Example title="The ruler" layout="block" note="Under page titles: a tick for every quarter hour, a longer one for every hour.">
        <div className="ruler" aria-hidden="true" />
      </Example>
      <Example title="Icons">
        {icons.map((name) => (
          <span key={name} className="icon-sample">
            <Icon name={name} />
            <span>{name}</span>
          </span>
        ))}
      </Example>
    </Section>
  )
}
