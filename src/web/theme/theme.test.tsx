import { readFileSync } from 'node:fs'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeMenu } from '../shell/ThemeMenu'
import { getThemeChoice, resetThemeChoice, setThemeChoice, themeStorageKey } from './theme'

const initScript = readFileSync('src/web/public/theme-init.js', 'utf8')
/** As the browser would, before the app. */
const runInitScript = () => {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  new Function(initScript)()
}
const shownTheme = () => document.documentElement.getAttribute('data-theme')

beforeEach(() => {
  localStorage.clear()
  resetThemeChoice()
})

describe('theme choice', () => {
  it('is System by default, with nothing stored', () => {
    expect(getThemeChoice()).toBe('system')
    expect(shownTheme()).toBeNull()
    expect(localStorage).toHaveLength(0)
  })

  it.each(['light', 'dark'] as const)('%s is applied, stored, and applied again before the next start', (choice) => {
    setThemeChoice(choice)
    expect(shownTheme()).toBe(choice)
    expect(localStorage.getItem(themeStorageKey)).toBe(choice)
    document.documentElement.removeAttribute('data-theme')
    runInitScript()
    expect(shownTheme()).toBe(choice)
    resetThemeChoice()
    expect(getThemeChoice()).toBe(choice)
  })

  it('going back to System removes what was stored', () => {
    setThemeChoice('dark')
    setThemeChoice('system')
    expect(shownTheme()).toBeNull()
    expect(localStorage).toHaveLength(0)
  })

  it('has a prefixed key', () => expect(themeStorageKey).toMatch(/^jettime\./))

  it.each(['purple', '', 'system', 'DARK'])('treats the stored value "%s" as System', (value) => {
    localStorage.setItem(themeStorageKey, value)
    resetThemeChoice()
    runInitScript()
    expect(getThemeChoice()).toBe('system')
    expect(shownTheme()).toBeNull()
  })

  it('works for the visit when storage is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(runInitScript).not.toThrow()
    resetThemeChoice()
    expect(getThemeChoice()).toBe('system')
    setThemeChoice('dark')
    expect(shownTheme()).toBe('dark')
    expect(getThemeChoice()).toBe('dark')
  })
})

describe('ThemeMenu', () => {
  it('offers System, Light and Dark, and marks the choice', async () => {
    render(<ThemeMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'Appearance: System' }))
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(['System', 'Light', 'Dark'])
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toBeChecked()
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }))
    expect(shownTheme()).toBe('dark')
    expect(screen.getByRole('button', { name: 'Appearance: Dark' })).toHaveFocus()
  })

  it('follows a choice made in another tab', () => {
    render(<ThemeMenu />)
    localStorage.setItem(themeStorageKey, 'light')
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: themeStorageKey })))
    expect(screen.getByRole('button', { name: 'Appearance: Light' })).toBeInTheDocument()
    expect(shownTheme()).toBe('light')
  })
})
