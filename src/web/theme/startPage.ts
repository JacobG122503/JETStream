/** Where the app begins for someone on this device. */
export const startPageKey = 'jetstream.start'

export function startsAtHome(): boolean {
  try {
    return window.localStorage.getItem(startPageKey) !== 'time'
  } catch {
    return true
  }
}

export function setStartsAtHome(home: boolean) {
  try {
    if (home) window.localStorage.removeItem(startPageKey)
    else window.localStorage.setItem(startPageKey, 'time')
  } catch {
    // Storage is blocked: the app begins at Home.
  }
}
