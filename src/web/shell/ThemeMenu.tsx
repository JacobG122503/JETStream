import { type ThemeChoice, useThemeChoice } from '../theme/theme'
import { type IconName, Menu } from '../ui'

const choices: { id: ThemeChoice; label: string; icon: IconName }[] = [
  { id: 'system', label: 'System', icon: 'monitor' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
]

export function ThemeMenu() {
  const [choice, setChoice] = useThemeChoice()
  const current = choices.find(({ id }) => id === choice) ?? choices[0]
  return (
    <Menu
      label={`Appearance: ${current?.label}`}
      icon={current?.icon}
      iconOnly
      variant="quiet"
      align="end"
      items={choices.map(({ id, label, icon }) => ({
        id,
        label,
        icon,
        checked: id === choice,
        onSelect: () => setChoice(id),
      }))}
    />
  )
}
