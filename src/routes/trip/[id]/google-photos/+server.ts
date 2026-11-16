import { error, json } from '@sveltejs/kit';
import { requireSession, rateLimit } from '#lib/server/auth.ts';
import { googlePhotos } from '#lib/server/google-photos.ts';
import { GooglePhotosError } from '#lib/server/google-photos-picker.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const session = requireSession(event);
  if (!session.member_id) error(403, 'Trip membership required.');
  if (event.request.headers.get('origin') !== event.url.origin) error(403, 'Invalid origin.');
  rateLimit(`google-photos:${session.user.id}`);
  try {
    const result = await googlePhotos.start(
      session.user.id,
      session.trip_id,
      `${event.url.origin}/auth/google-photos/callback`
    );
    if (result.browser)
      event.cookies.set('google-photos-oauth', result.browser, {
        path: '/auth/google-photos',
        httpOnly: true,
        sameSite: 'lax',
        secure: event.url.protocol === 'https:',
        maxAge: 600
      });
    return json(
      { jobId: result.jobId, url: result.url },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    return json(
      {
        error:
          cause instanceof GooglePhotosError
            ? cause.message
            : 'Could not open Google Photos. Try again.'
      },
      { status: 400 }
    );
  }
};
