import sharp from 'sharp';
import { join } from 'node:path';
import { receiptStorage } from './receipt-storage';

export const maxPlacePhotoBytes = 10 * 1024 * 1024;
export class PlacePhotoError extends Error {}

export async function preparePlacePhoto(input: Buffer) {
  if (!input.length || input.length > maxPlacePhotoBytes)
    throw new PlacePhotoError('Choose photos up to 10 MB each.');
  try {
    const image = sharp(input, { limitInputPixels: 64_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp', 'heif', 'tiff'].includes(metadata.format))
      throw new Error('Unsupported photo format.');
    // Normalize phone orientation and strip metadata, including GPS coordinates.
    const full = await image
      .autoOrient()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(full.data)
      .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return { full: full.data, thumbnail, width: full.info.width, height: full.info.height };
  } catch {
    throw new PlacePhotoError('Choose a valid JPEG, PNG, WebP, AVIF or TIFF photo.');
  }
}

export function placePhotoStorage(directory: string) {
  const full = receiptStorage(join(directory, 'full'));
  const thumbnails = receiptStorage(join(directory, 'thumbnails'));
  return {
    check() {
      full.check();
      thumbnails.check();
    },
    async put(id: string, photo: Awaited<ReturnType<typeof preparePlacePhoto>>) {
      await full.put(id, photo.full);
      try {
        await thumbnails.put(id, photo.thumbnail);
      } catch (error) {
        await full.remove(id);
        throw error;
      }
    },
    read(id: string, thumbnail = false) {
      return (thumbnail ? thumbnails : full).read(id);
    },
    async remove(id: string) {
      await Promise.all([full.remove(id), thumbnails.remove(id)]);
    }
  };
}
