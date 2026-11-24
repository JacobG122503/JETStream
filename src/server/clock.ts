import { type IsoDate, partsOf, toIso } from '../shared/dates'

/** The calendar date in a time zone. */
export function todayIn(timeZone: string, now = new Date()): IsoDate {
  const { year, month, day } = wallClock(now, timeZone)
  return toIso({ year, month, day })
}

/** The moment a clock in the time zone shows the date and the minutes after midnight. */
export function instantAt(date: IsoDate, minuteOfDay: number, timeZone: string): Date {
  const { year, month, day } = partsOf(date)
  const wanted = Date.UTC(year, month - 1, day, 0, minuteOfDay)
  let guess = wanted
  // Twice, because the first correction can cross a clock change.
  for (let round = 0; round < 2; round++) {
    const shown = wallClock(new Date(guess), timeZone)
    guess += wanted - Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute)
  }
  return new Date(guess)
}

const formats = new Map<string, Intl.DateTimeFormat>()

/** Formatters are slow to make, so each is made once. */
function formatFor(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    })
    formats.set(timeZone, format)
  }
  return format
}

function wallClock(at: Date, timeZone: string) {
  const parts = formatFor(timeZone).formatToParts(at)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') }
}
