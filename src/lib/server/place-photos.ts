import * as env from '$app/env/private';
import { dirname, join, resolve } from 'node:path';
import { db, id } from './db';
import {
  placePhotoStorage,
  preparePlacePhoto,
  maxPlacePhotoBytes,
  PlacePhotoError
} from './place-photo-files';

const files = placePhotoStorage(
  join(dirname(resolve(env.DATABASE_PATH || './data/housik.sqlite')), 'place-photos')
);
export const checkPlacePhotoStorage = () => files.check();

export function savePlacePhoto(
  tripId: string,
  file: File
): Promise<{ id: string; width: number; height: number }>;
export function savePlacePhoto(
  tripId: string,
  file: File,
  sourceId: string
): Promise<{ id: string; width: number; height: number } | null>;
export async function savePlacePhoto(
  tripId: string,
  file: File,
  sourceId?: string
): Promise<{ id: string; width: number; height: number } | null> {
  if (
    sourceId &&
    db
      .prepare('SELECT 1 FROM place_photo_imports WHERE trip_id=? AND source_id=?')
      .get(tripId, sourceId)
  )
    return null;
  if (!file.size || file.size > maxPlacePhotoBytes)
    throw new PlacePhotoError('Choose photos up to 10 MB each.');
  const photo = await preparePlacePhoto(Buffer.from(await file.arrayBuffer()));
  const photoId = id();
  await files.put(photoId, photo);
  try {
    const saved = db.transaction(() => {
      if (
        sourceId &&
        db
          .prepare('SELECT 1 FROM place_photo_imports WHERE trip_id=? AND source_id=?')
          .get(tripId, sourceId)
      )
        return false;
      db.prepare('INSERT INTO place_photos(id,trip_id,width,height) VALUES(?,?,?,?)').run(
        photoId,
        tripId,
        photo.width,
        photo.height
      );
      if (sourceId)
        db.prepare('INSERT INTO place_photo_imports(trip_id,source_id,photo_id) VALUES(?,?,?)').run(
          tripId,
          sourceId,
          photoId
        );
      return true;
    })();
    if (!saved) {
      await files.remove(photoId);
      return null;
    }
  } catch (error) {
    await files.remove(photoId);
    throw error;
  }
  return { id: photoId, width: photo.width, height: photo.height };
}

export const readPlacePhoto = (photoId: string, thumbnail: boolean) =>
  files.read(photoId, thumbnail);

export async function removePlacePhoto(tripId: string, photoId: string) {
  const result = db
    .prepare('DELETE FROM place_photos WHERE id=? AND trip_id=?')
    .run(photoId, tripId);
  if (!result.changes) return false;
  // The gallery record is authoritative. Cleanup failure must not resurrect an
  // already removed photo or make the client retry deleting another image.
  await files.remove(photoId).catch((error) => console.error('Photo file cleanup failed:', error));
  return true;
}
