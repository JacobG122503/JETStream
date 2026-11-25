import { useMemo } from 'react'
import { Combobox, type ComboboxProps } from '../ui'
import { timeZoneOptions } from './timeZones'

export interface TimeZoneFieldProps extends Pick<ComboboxProps, 'id' | 'error' | 'value' | 'onChange' | 'hint'> {
  /** Offered even if the browser does not know it. */
  companyTimeZone: string
}

export function TimeZoneField({ companyTimeZone, value, ...rest }: TimeZoneFieldProps) {
  const options = useMemo(() => timeZoneOptions(companyTimeZone, ...(value === null ? [] : [value])), [companyTimeZone, value])
  return <Combobox label="Time zone" required options={options} value={value} {...rest} />
}
