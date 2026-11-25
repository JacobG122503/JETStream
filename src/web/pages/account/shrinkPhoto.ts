import { photoLimits } from '../../../shared/accounts'

const side = 512
export const photoTypes = ['image/png', 'image/jpeg', 'image/webp']

/** A picture that cannot be used; the message is for whoever chose it. */
export class PhotoError extends Error {}

/** The middle square of a picture, small enough for the server. Also leaves out what cameras add. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  if (!photoTypes.includes(file.type)) throw new PhotoError('Choose a PNG, JPEG or WebP picture.')
  if (file.size > photoLimits.sourceBytes) throw new PhotoError('The picture is larger than 10 MB. Choose a smaller one.')
  let picture: ImageBitmap
  try {
    // Turns the picture the way the camera was held.
    picture = await createImageBitmap(file)
  } catch {
    throw new PhotoError('The picture could not be read. It may be damaged.')
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const context = canvas.getContext('2d')
    if (!context) throw new PhotoError('This browser cannot change pictures.')
    // Transparent parts would turn black.
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--c-photo-ground')
    context.fillRect(0, 0, side, side)
    const { x, y, size } = middleSquare(picture.width, picture.height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(picture, x, y, size, size, 0, 0, side, side)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    if (!blob) throw new PhotoError('This browser cannot change pictures.')
    return blob
  } finally {
    picture.close()
  }
}

export function middleSquare(width: number, height: number) {
  const size = Math.min(width, height)
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size }
}
