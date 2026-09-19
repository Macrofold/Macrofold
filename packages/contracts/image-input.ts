import { imageSize } from 'image-size';
import { mediaLimits } from './media';

/** Byte/header validation shared by attachment preparation and model admission.
 * Full decoding is left to the model provider; no URLs or filesystem I/O here. */
export function validateImage(bytes: Uint8Array, mediaType: string) {
  if (!bytes.length || bytes.length > mediaLimits.imageBytes) throw new Error('image_size_exceeded');
  const image = imageSize(bytes);
  const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[image.type || ''];
  if (!mime || mime !== mediaType) throw new Error('invalid_image_format');
  if (
    !image.width ||
    !image.height ||
    image.width > mediaLimits.imageSide ||
    image.height > mediaLimits.imageSide
  )
    throw new Error('image_dimensions_exceeded');
  return {
    mediaType: mime as 'image/png' | 'image/jpeg' | 'image/webp',
    width: image.width,
    height: image.height,
  };
}
