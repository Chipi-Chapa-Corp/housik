// Test-process-only transport. Production code has no endpoint overrides.
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
if (process.env.HOUSIK_GOOGLE_PHOTOS_FIXTURE === 'true') {
  const original = globalThis.fetch;
  const directory = process.env.HOUSIK_TEST_DIR;
  mkdirSync(directory, { recursive: true });
  let sequence = 0;
  const videoPath = join(directory, 'provider-video.mp4');
  execFileSync('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x180:rate=12',
    '-t',
    '2',
    '-c:v',
    'mpeg4',
    '-q:v',
    '5',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '1',
    videoPath
  ]);
  const video = readFileSync(videoPath);
  const photo = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#a3bcb5' }
  })
    .jpeg()
    .toBuffer();
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    );
    if (
      ![
        'oauth2.googleapis.com',
        'photospicker.googleapis.com',
        'lh3.googleusercontent.com'
      ].includes(url.hostname)
    )
      return original(input, init);
    appendFileSync(
      join(directory, 'google-calls.jsonl'),
      JSON.stringify({ host: url.hostname, path: url.pathname, method: init?.method || 'GET' }) +
        '\n'
    );
    if (url.hostname === 'oauth2.googleapis.com')
      return Response.json({
        access_token: 'fixture-access',
        refresh_token: 'fixture-refresh',
        expires_in: 3600
      });
    if (url.hostname === 'lh3.googleusercontent.com') {
      if (url.href.endsWith('=dv'))
        return new Response(video, { headers: { 'Content-Type': 'video/mp4' } });
      return new Response(photo, { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.pathname === '/v1/sessions') {
      const id = `fixture-session-${++sequence}`;
      return Response.json({
        id,
        pickerUri: `https://photos.google.com/picker/${id}`,
        expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
        pollingConfig: { pollInterval: '1s', timeoutIn: '1800s' }
      });
    }
    if (url.pathname.startsWith('/v1/sessions/'))
      return Response.json({
        mediaItemsSet: existsSync(join(directory, url.pathname.split('/').at(-1) + '.selected')),
        pollingConfig: { pollInterval: '1s', timeoutIn: '1800s' }
      });
    const index = Number(url.searchParams.get('sessionId')?.split('-').at(-1));
    const ids = existsSync(join(directory, 'video-mode'))
      ? ['video-photo-one', 'video-photo-two', 'video-photo-three', 'clip']
      : index === 1
        ? ['one', 'two']
        : ['one', 'two', 'three'];
    return Response.json({
      mediaItems: ids.map((id) => ({
        id,
        type: id === 'clip' ? 'VIDEO' : 'PHOTO',
        mediaFile: {
          baseUrl: `https://lh3.googleusercontent.com/${id}`,
          mimeType: id === 'clip' ? 'video/mp4' : 'image/jpeg',
          filename: `${id}.jpg`
        }
      }))
    });
  };
}
