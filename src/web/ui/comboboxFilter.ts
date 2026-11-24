export interface ComboboxOption {
  value: string
  label: string
  /** Options of a group must follow each other. */
  group?: string
  disabled?: boolean
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()

/** Options whose group and label contain the query, ignoring case, accents and extra spaces. */
export function filterOptions<T extends ComboboxOption>(options: T[], query: string): T[] {
  const wanted = fold(query).trim().replace(/\s+/g, ' ')
  return options.filter((option) => fold(`${option.group ?? ''} ${option.label}`).includes(wanted))
}
