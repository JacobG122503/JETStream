import { apiUrl } from '../basePath'

/** Address of a person's photo, if there is one. */
export const photoUrl = (photoId: number | null) => (photoId === null ? undefined : apiUrl(`photos/${photoId}`))
