// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const webDir = fileURLToPath(new URL('..', import.meta.url))
const css = readFileSync(join(webDir, 'styles/tokens.css'), 'utf8')

type Mode = 'light' | 'dark'

function token(name: string, mode: Mode): string {
  const value = new RegExp(`--c-${name}: ([^;]+);`).exec(css)?.[1]
  if (!value) throw new Error(`No token --c-${name}`)
  const pair = /^light-dark\((#\w+), (#\w+)\)$/.exec(value)
  return (pair ? pair[mode === 'light' ? 1 : 2] : value) ?? ''
}

function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Error(`Not a colour: ${hex}`)
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

const surfaces = ['bg', 'surface', 'surface-2', 'surface-3']

/** Text tokens and the backgrounds they are used on: at least 4.5:1. */
const textPairs: [string, string[]][] = [
  ['text', [...surfaces, 'accent-soft']],
  ['text-muted', [...surfaces, 'accent-soft']],
  ['accent', [...surfaces]],
  ['accent-hover', [...surfaces]],
  ['on-accent', ['accent', 'accent-hover']],
  ['on-accent-soft', ['accent-soft']],
  ['on-brand', ['brand', 'brand-hover', 'brand-active']],
  ['danger', ['bg', 'surface', 'surface-2', 'surface-3', 'danger-soft']],
  ['on-danger-solid', ['danger-solid', 'danger-solid-hover', 'danger-solid-active']],
  ['on-success-soft', ['success-soft']],
  ['on-warning-soft', ['warning-soft']],
  ['on-danger-soft', ['danger-soft']],
  ['on-info-soft', ['info-soft']],
  ['nav-text', ['nav-bg', 'nav-hover']],
  ['nav-strong', ['nav-bg', 'nav-hover']],
  ['tooltip-text', ['tooltip-bg']],
  ['avatar-text', ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4']],
]

/** Input borders, focus rings, icons, indicators and what they touch: at least 3:1. */
const graphicPairs: [string, string[]][] = [
  ['border-strong', ['bg', 'surface', 'surface-2']],
  ['focus', [...surfaces, 'accent-soft', 'danger-soft', 'warning-soft', 'info-soft', 'success-soft']],
  ['nav-focus', ['nav-bg', 'nav-hover']],
  ['nav-bg', ['brand']],
  ['accent', ['bg', 'surface', 'surface-2', 'surface-3', 'accent-soft']],
  ['danger', ['bg', 'surface', 'surface-3', 'danger-soft']],
  ['warning', ['bg', 'surface', 'surface-3', 'warning-soft']],
  ['success', ['bg', 'surface', 'surface-3', 'success-soft']],
  ['info', ['bg', 'surface', 'surface-3', 'info-soft']],
  ['on-danger-solid', ['danger-solid']],
]

describe.each<Mode>(['light', 'dark'])('contrast in %s mode', (mode) => {
  const expand = (pairs: [string, string[]][]) =>
    pairs.flatMap(([front, backs]) => backs.map((back): [string, string] => [front, back]))

  it.each(expand(textPairs))('text %s on %s is at least 4.5:1', (front, back) => {
    expect(contrast(token(front, mode), token(back, mode))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(expand(graphicPairs))('%s next to %s is at least 3:1', (front, back) => {
    expect(contrast(token(front, mode), token(back, mode))).toBeGreaterThanOrEqual(3)
  })
})

describe('brand colour', () => {
  it('is mediumseagreen, defined once', () => {
    expect(token('brand', 'light')).toBe('#3cb371')
    expect(css.match(/#3cb371/gi)).toHaveLength(1)
  })

  it('measures contrast as WCAG does', () => {
    expect(contrast('#3cb371', '#ffffff')).toBeCloseTo(2.67, 2)
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })
})

/** Every colour name of CSS, apart from the allowed `transparent` and `currentColor`. */
const colourNames = `
  aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
  cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod
  darkgr[ae]y darkgreen darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon
  darkseagreen darkslateblue darkslategr[ae]y darkturquoise darkviolet deeppink deepskyblue dimgr[ae]y
  dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gr[ae]y green
  greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon
  lightblue lightcoral lightcyan lightgoldenrodyellow lightgr[ae]y lightgreen lightpink lightsalmon
  lightseagreen lightskyblue lightslategr[ae]y lightsteelblue lightyellow lime limegreen linen magenta maroon
  mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
  mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive
  olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff
  peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen
  seashell sienna silver skyblue slateblue slategr[ae]y snow springgreen steelblue tan teal thistle tomato
  turquoise violet wheat white whitesmoke yellow yellowgreen
`.trim().split(/\s+/).join('|')
const colourName = `(?<![\\w-])(?:${colourNames})(?![\\w-])`

/** In a style sheet: a colour name in the value of a declaration, also in the last one of a block. */
const namedInCss = new RegExp(`:[^;{}]*${colourName}[^;{}]*[;}]`, 'i')
/**
 * In a component: a string that is just a colour name, or one with a colour name in it that is
 * given to a property or attribute that takes colours, such as border or fill.
 */
const namedInTsx = new RegExp(
  `(['"\`])(?:${colourNames})\\1|(?:colou?r|background|fill|stroke|border\\w*|outline|shadow|image)['"]?\\s*[:=,]\\s*\\{?\\s*(['"\`])(?:(?!\\2).)*${colourName}`,
  'i',
)

describe('finding named colours', () => {
  it.each(['a { color: tomato; }', 'a { color: tomato }', 'a{border:1px solid Tan}', 'a { background: linear-gradient(red, var(--c-bg)); }', 'a { color: DarkSlateGrey; }'])(
    'finds one in %s',
    (source) => expect(source).toMatch(namedInCss),
  )

  it.each(['a { color: var(--c-tomato); }', '.red { margin: 0; }', 'a:hover .tomato { margin: 0; }', 'a { color: transparent; }', 'a { color: currentColor; }', 'a { white-space: nowrap; }'])(
    'finds none in %s',
    (source) => expect(source).not.toMatch(namedInCss),
  )

  it.each([
    "<p style={{ color: 'tomato' }}>",
    "<p style={{ color: bad ? 'tomato' : undefined }}>",
    '<p style={{ border: "1px solid tan" }}>',
    "<p style={{ 'borderTopColor': `Plum` }}>",
    '<path fill="red" />',
    "<path stroke={'steelblue'} />",
    "element.style.setProperty('background', 'linear-gradient(white, snow)')",
  ])('finds one in %s', (source) => expect(source).toMatch(namedInTsx))

  it.each(["<p style={{ color: 'var(--c-red)' }}>", '<p>The red line</p>', "<Badge tone='info'>Green light</Badge>", "label: 'Red Lake project'", '<path fill="currentColor" />'])(
    'finds none in %s',
    (source) => expect(source).not.toMatch(namedInTsx),
  )
})

describe('styles outside the tokens', () => {
  const files = (readdirSync(webDir, { recursive: true }) as string[]).filter(
    (file) => /\.(css|tsx?)$/.test(file) && !/\.test\.tsx?$/.test(file) && file !== join('styles', 'tokens.css'),
  )
  const read = (file: string) =>
    readFileSync(join(webDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|(?<=^|\s)\/\/.*$/gm, '')

  it.each(files)('%s has no colour literal', (file) => {
    const source = read(file)
    expect(source).not.toMatch(/#[0-9a-f]{3,8}(?![\w-])/i)
    expect(source).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/)
    expect(source).not.toMatch(file.endsWith('.css') ? namedInCss : namedInTsx)
  })

  it.each(files.filter((file) => file.endsWith('.css')))('%s takes spacing, type and layers from tokens', (file) => {
    const source = read(file)
    for (const [, property, value = ''] of source.matchAll(
      /(?<![\w-])((?:padding|margin|gap|row-gap|column-gap)[\w-]*|z-index|border-radius|box-shadow|font-size):\s*([^;]+);/g,
    )) {
      // What is left after tokens, zero, keywords and factors must hold no length. The hidden
      // text of .sr-only and sizes relative to the text (em) are not part of the scale.
      const rest = value
        .replace(/var\([^()]*\)/g, '')
        .replace(/(?<![\w.])(0|-1px|50%|100%|-?[\d.]+em)(?![\w.])/g, '')
        .replace(/env\([^()]*\)/g, '')
      expect(`${property}: ${rest}`).not.toMatch(/[\d.]+(px|rem|vw|vh|pt)|z-index:\s*\d/)
    }
  })
})
