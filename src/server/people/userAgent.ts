/** A browser and system in words, from what the browser says about itself. Only for people to recognise a device. */
export function describeUserAgent(userAgent: string | null): { browser: string; system: string } {
  const text = userAgent ?? ''
  const first = (list: [RegExp, string][], other: string) => list.find(([pattern]) => pattern.test(text))?.[1] ?? other
  return {
    browser: first(
      [
        [/Edg(e|A|iOS)?\//, 'Edge'],
        [/OPR\/|Opera/, 'Opera'],
        [/SamsungBrowser\//, 'Samsung Internet'],
        [/Firefox\/|FxiOS\//, 'Firefox'],
        [/HeadlessChrome\/|Chrome\/|CriOS\//, 'Chrome'],
        [/Safari\//, 'Safari'],
      ],
      'Unknown browser',
    ),
    system: first(
      [
        [/iPhone/, 'iPhone'],
        [/iPad/, 'iPad'],
        [/Android/, 'Android'],
        [/Windows/, 'Windows'],
        [/Mac OS X|Macintosh/, 'macOS'],
        [/CrOS/, 'ChromeOS'],
        [/Linux/, 'Linux'],
      ],
      'Unknown system',
    ),
  }
}
