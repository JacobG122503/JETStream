import { layerExemptAttribute } from './overlay/layers'

type Politeness = 'polite' | 'assertive'

const regions: Partial<Record<Politeness, HTMLElement>> = {}

/** Says something to screen readers without showing it or moving focus. */
export function announce(message: string, politeness: Politeness = 'polite') {
  let region = regions[politeness]
  if (!region?.isConnected) {
    region = document.createElement('div')
    region.className = 'sr-only'
    region.setAttribute('aria-live', politeness)
    region.setAttribute('aria-atomic', 'true')
    region.setAttribute('data-announcer', '')
    region.setAttribute(layerExemptAttribute, '')
    document.body.append(region)
    regions[politeness] = region
  }
  const target = region
  target.textContent = ''
  // A screen reader notices the change only if the element was there, and empty, before.
  setTimeout(() => {
    target.textContent = message
  }, 50)
}
