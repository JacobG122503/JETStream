/** The prefix the app is served under. Always starts and ends with "/". */
export const basePath = import.meta.env.DEV ? import.meta.env.BASE_URL : readMetaTag()

function readMetaTag(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="base-path"]')?.content ?? '/'
}

/** Address of an API route, such as apiUrl('health'). */
export function apiUrl(route: string): string {
  return `${basePath}api/${route}`
}
