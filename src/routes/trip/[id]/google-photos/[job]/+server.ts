import { error, json } from '@sveltejs/kit';
import { requireSession } from '#lib/server/auth.ts';
import { googlePhotos } from '#lib/server/google-photos.ts';
import { GooglePhotosError } from '#lib/server/google-photos-picker.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const session = requireSession(event);
  if (!session.member_id) error(403, 'Trip membership required.');
  if (event.request.headers.get('origin') !== event.url.origin) error(403, 'Invalid origin.');
  try {
    return json(await googlePhotos.poll(event.params.job, session.user.id, session.trip_id), {
      headers: { 'Cache-Control': 'private, no-store' }
    });
  } catch (cause) {
    return json(
      {
        error:
          cause instanceof GooglePhotosError
            ? cause.message
            : 'Could not import Google Photos. Try again.'
      },
      { status: 400 }
    );
  }
};
export const DELETE: RequestHandler = async (event) => {
  const session = requireSession(event);
  if (!session.member_id) error(403, 'Trip membership required.');
  if (event.request.headers.get('origin') !== event.url.origin) error(403, 'Invalid origin.');
  try {
    await googlePhotos.cancel(event.params.job, session.user.id, session.trip_id);
    return json({ success: true });
  } catch {
    return json({ error: 'Photo selection is no longer available.' }, { status: 404 });
  }
};
