const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]',
].join(',')

function isShown(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert]')) return false
  // jsdom has no layout, so there every element counts as shown.
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({ visibilityProperty: true })
  }
  return true
}

/** The elements of `root` that the Tab key stops at, in order. */
export function tabbable(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => {
    if (element.tabIndex < 0 || !isShown(element)) return false
    if (element.matches('fieldset[disabled] *')) return false
    if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
      // Tab stops once per group of radio buttons: at the chosen one, or the first.
      const group = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
        (radio) => radio.name === element.name && radio.form === element.form && !radio.disabled,
      )
      return element === (group.find((radio) => radio.checked) ?? group[0])
    }
    return true
  })
}

export function canTakeFocus(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element !== document.body &&
    element.isConnected &&
    !element.matches(':disabled') &&
    isShown(element)
  )
}

/** Focuses the page's heading, or else its main area. */
export function focusPageHeading() {
  const target = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main')
  if (!target) return
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1
  target.focus({ preventScroll: true })
}

/** Focuses the field with this id, or the first control inside the element with it. */
export function focusField(id: string) {
  const element = document.getElementById(id)
  if (!element) return
  const control = element.matches('input, select, textarea, button') ? element : (tabbable(element)[0] ?? element)
  if (control.tabIndex < 0 && !control.hasAttribute('tabindex')) control.tabIndex = -1
  control.focus()
}
