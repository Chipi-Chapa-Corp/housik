import { error, json, isHttpError } from '@sveltejs/kit';
import { requireSession } from '#lib/server/auth.ts';
import { savePlacePhoto } from '#lib/server/place-photos.ts';
import { PlacePhotoError } from '#lib/server/place-photo-files.ts';
import { maxPlaceVideoBytes } from '#lib/place-media.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const session = requireSession(event);
  if (!session.member_id) error(403, 'Trip membership required.');
  if (event.request.headers.get('origin') !== event.url.origin) error(403, 'Invalid origin.');
  if (Number(event.request.headers.get('content-length') || 0) > maxPlaceVideoBytes + 1024 * 1024)
    return json({ error: 'Choose videos up to 250 MB each.' }, { status: 413 });
  try {
    const form = await event.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new PlacePhotoError('Choose a place photo.');
    return json(await savePlacePhoto(session.trip_id, file), { status: 201 });
  } catch (cause) {
    if (isHttpError(cause)) throw cause;
    if (!(cause instanceof PlacePhotoError)) console.error('Place photo upload failed:', cause);
    return json(
      {
        error:
          cause instanceof PlacePhotoError ? cause.message : 'Could not save the photo. Try again.'
      },
      { status: cause instanceof PlacePhotoError ? 400 : 500 }
    );
  }
};
