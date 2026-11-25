import { useEffect, useRef } from 'react'

/** Single keys that do something, as long as nothing is being typed and no dialog is open. */
export function useShortcuts(keys: Record<string, () => void>, active: boolean) {
  const current = useRef(keys)
  useEffect(() => {
    current.current = keys
  })
  useEffect(() => {
    if (!active) return
    const pressed = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      const { target } = event
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable], [role="menu"], [role="dialog"], [role="tablist"], [role="region"]')) return
      const work = current.current[event.key]
      if (!work) return
      event.preventDefault()
      work()
    }
    document.addEventListener('keydown', pressed)
    return () => document.removeEventListener('keydown', pressed)
  }, [active])
}
