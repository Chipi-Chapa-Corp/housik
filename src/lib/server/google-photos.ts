import * as env from '$app/env/private';
import { db } from './db';
import { savePlacePhoto } from './place-photos';
import { googlePhotosPicker } from './google-photos-picker';

export const googlePhotos = googlePhotosPicker({
  db,
  clientId: env.GOOGLE_PHOTOS_CLIENT_ID,
  clientSecret: env.GOOGLE_PHOTOS_CLIENT_SECRET,
  canImport: (userId, tripId) =>
    !!db
      .prepare(
        'SELECT 1 FROM members m JOIN users u ON m.username=u.username COLLATE NOCASE WHERE m.trip_id=? AND u.id=?'
      )
      .get(tripId, userId),
  save: async (tripId, bytes, sourceId) =>
    !!(await savePlacePhoto(
      tripId,
      new File([new Uint8Array(bytes)], 'google-photo.jpg'),
      sourceId
    ))
});
