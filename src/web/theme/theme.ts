import { useSyncExternalStore } from 'react'

/**
 * The appearance chosen on this device. "system" is the default and is not stored. The choice is
 * the data-theme attribute of <html>; styles/tokens.css does the rest, so following the operating
 * system needs no code. public/theme-init.js sets the attribute before the first paint.
 */
export const themeChoices = ['system', 'light', 'dark'] as const
export type ThemeChoice = (typeof themeChoices)[number]

/** Prefixed because other applications on the same server may share the browser's storage. */
export const themeStorageKey = 'jettime.theme'

const listeners = new Set<() => void>()

/** The choice for this visit, for when the browser's storage cannot be used. */
let current: ThemeChoice | undefined

function readStored(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(themeStorageKey)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function apply(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', choice)
}

export function getThemeChoice(): ThemeChoice {
  current ??= readStored()
  return current
}

export function setThemeChoice(choice: ThemeChoice) {
  current = choice
  apply(choice)
  try {
    if (choice === 'system') window.localStorage.removeItem(themeStorageKey)
    else window.localStorage.setItem(themeStorageKey, choice)
  } catch {
    // Storage is blocked or full: the choice lasts for this visit.
  }
  listeners.forEach((listener) => listener())
}

function onStorage(event: StorageEvent) {
  // key is null when everything was cleared.
  if (event.key !== themeStorageKey && event.key !== null) return
  current = readStored()
  apply(current)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  return [useSyncExternalStore(subscribe, getThemeChoice), setThemeChoice]
}

/** For tests: forgets the choice of this visit. */
export function resetThemeChoice() {
  current = undefined
  apply(getThemeChoice())
}
