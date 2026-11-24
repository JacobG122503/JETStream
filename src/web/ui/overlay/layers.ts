/**
 * Open modal layers (dialogs, the navigation drawer), the top one last. Everything else on the
 * page is inert, except elements marked with layerExemptAttribute (toasts and announcements),
 * which stay usable above a dialog. That is also why dialogs do not set aria-modal: it would hide
 * those from assistive technology, and `inert` already hides the page.
 */
interface Layer {
  /** A child of <body>. */
  root: HTMLElement
}

export const layerExemptAttribute = 'data-layer-exempt'

const layers: Layer[] = []
const madeInert = new Set<HTMLElement>()

function update() {
  const top = layers.at(-1)
  madeInert.forEach((element) => element.removeAttribute('inert'))
  madeInert.clear()
  if (top) {
    for (const element of document.body.children) {
      if (!(element instanceof HTMLElement) || element === top.root) continue
      if (element.hasAttribute(layerExemptAttribute) || element.hasAttribute('inert')) continue
      element.setAttribute('inert', '')
      madeInert.add(element)
    }
  }
  lockScroll(top !== undefined)
}

let restoreScroll: (() => void) | undefined

function lockScroll(locked: boolean) {
  if (locked && !restoreScroll) {
    const { documentElement: html, body } = document
    const scrollbar = window.innerWidth - html.clientWidth
    html.style.overflow = 'hidden'
    // Keeps the page from moving sideways when its scrollbar goes.
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`
    restoreScroll = () => {
      html.style.overflow = ''
      body.style.paddingRight = ''
    }
  } else if (!locked && restoreScroll) {
    restoreScroll()
    restoreScroll = undefined
  }
}

export function pushLayer(root: HTMLElement): () => void {
  const layer = { root }
  layers.push(layer)
  update()
  return () => {
    layers.splice(layers.indexOf(layer), 1)
    update()
  }
}

export function isTopLayer(root: HTMLElement): boolean {
  return layers.at(-1)?.root === root
}
