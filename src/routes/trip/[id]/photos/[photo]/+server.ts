import { error, json } from '@sveltejs/kit';
import { requireSession } from '#lib/server/auth.ts';
import { db } from '#lib/server/db.ts';
import { readPlacePhoto, removePlacePhoto } from '#lib/server/place-photos.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const session = requireSession(event);
  if (
    !db
      .prepare('SELECT 1 FROM place_photos WHERE id=? AND trip_id=?')
      .get(event.params.photo, session.trip_id)
  )
    error(404, 'Photo not found.');
  try {
    return new Response(
      new Uint8Array(
        await readPlacePhoto(event.params.photo, event.url.searchParams.get('size') === 'thumbnail')
      ),
      {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'",
          'Cross-Origin-Resource-Policy': 'same-origin'
        }
      }
    );
  } catch {
    error(404, 'Photo file not found.');
  }
};

export const DELETE: RequestHandler = async (event) => {
  const session = requireSession(event);
  if (!session.member_id) error(403, 'Trip membership required.');
  if (event.request.headers.get('origin') !== event.url.origin) error(403, 'Invalid origin.');
  if (!(await removePlacePhoto(session.trip_id, event.params.photo)))
    error(404, 'Photo not found.');
  return json({ success: true });
};
