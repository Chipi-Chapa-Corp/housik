import { error, redirect } from '@sveltejs/kit';
import { getSession } from '#lib/server/auth.ts';
import { googlePhotos } from '#lib/server/google-photos.ts';
import { GooglePhotosError } from '#lib/server/google-photos-picker.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = getSession(event);
  if (!user) error(401, 'Sign in to Housik, then reconnect Google Photos.');
  const browser = event.cookies.get('google-photos-oauth') || '';
  let pickerUrl: string;
  try {
    pickerUrl = await googlePhotos.callback(
      user.id,
      event.url.searchParams.get('state') || '',
      browser,
      event.url.searchParams.get('code') || '',
      event.url.searchParams.has('error')
    );
  } catch (cause) {
    return new Response(
      cause instanceof GooglePhotosError
        ? cause.message
        : 'Could not connect Google Photos. Close this tab and try again.',
      {
        status: 400,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer'
        }
      }
    );
  }
  event.cookies.delete('google-photos-oauth', { path: '/auth/google-photos' });
  event.setHeaders({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  redirect(303, pickerUrl, { external: ['https://photos.google.com'] });
};
