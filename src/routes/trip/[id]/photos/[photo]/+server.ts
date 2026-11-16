import { error, json } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { requireSession } from '#lib/server/auth.ts';
import { db } from '#lib/server/db.ts';
import { byteRange } from '#lib/server/byte-range.ts';
import { openPlacePhoto, readPlacePhoto, removePlacePhoto } from '#lib/server/place-photos.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const session = requireSession(event);
  const media = db
    .prepare('SELECT mime FROM place_photos WHERE id=? AND trip_id=?')
    .get(event.params.photo, session.trip_id) as { mime: string } | undefined;
  if (!media) error(404, 'Photo not found.');
  const thumbnail = event.url.searchParams.get('size') === 'thumbnail';
  const headers: Record<string, string> = {
    'Content-Type': thumbnail ? 'image/webp' : media.mime,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin'
  };
  if (media.mime.startsWith('video/') && !thumbnail) {
    let file;
    try {
      file = await openPlacePhoto(event.params.photo);
    } catch {
      error(404, 'Video file not found.');
    }
    const { size } = await file.stat();
    headers['Accept-Ranges'] = 'bytes';
    let range;
    try {
      range = byteRange(
        event.request.headers.get('if-range') ? null : event.request.headers.get('range'),
        size
      );
    } catch {
      await file.close();
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${size}` }
      });
    }
    headers['Content-Length'] = String(range ? range.end - range.start + 1 : size);
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    if (event.request.method === 'HEAD') {
      await file.close();
      return new Response(null, { status: range ? 206 : 200, headers });
    }
    const stream = file.createReadStream({ ...(range ?? {}), autoClose: true });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: range ? 206 : 200,
      headers
    });
  }
  try {
    return new Response(new Uint8Array(await readPlacePhoto(event.params.photo, thumbnail)), {
      headers
    });
  } catch {
    error(404, 'Photo file not found.');
  }
};
export const HEAD = GET;
export const DELETE: RequestHandler = async (event) => {
  const session = requireSession(event);
  if (!session.member_id) error(403, 'Trip membership required.');
  if (event.request.headers.get('origin') !== event.url.origin) error(403, 'Invalid origin.');
  if (!(await removePlacePhoto(session.trip_id, event.params.photo)))
    error(404, 'Photo not found.');
  return json({ success: true });
};
