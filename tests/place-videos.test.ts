import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { preparePlaceVideo } from '../src/lib/server/place-video-files';
import { byteRange } from '../src/lib/server/byte-range';

test('phone videos become browser-compatible MP4 with matching poster ratio and no location tags', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'housik-video-test-'));
  try {
    const input = join(directory, 'clip.mov');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=180x320:r=12',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-t',
      '2',
      '-c:v',
      'mpeg4',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-metadata',
      'location=+50.1+014.4/',
      '-threads',
      '1',
      input
    ]);
    const result = await preparePlaceVideo(await readFile(input));
    assert.equal(result.mime, 'video/mp4');
    assert.equal(result.width, 180);
    assert.equal(result.height, 320);
    assert(result.duration >= 1.9 && result.duration <= 2.1);
    const poster = await sharp(result.thumbnail).metadata();
    assert.equal(poster.format, 'webp');
    assert.equal(poster.width! / poster.height!, 180 / 320);
    assert.equal(result.full.subarray(4, 8).toString(), 'ftyp');
    assert(!result.full.includes(Buffer.from('+50.1+014.4/')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid video content is rejected instead of saved as a broken media item', async () => {
  await assert.rejects(preparePlaceVideo(Buffer.from('not a video')), /valid MP4, MOV or WebM/);
  await assert.rejects(preparePlaceVideo(Buffer.alloc(0)), /250 MB/);
});

test('video ranges support seek, open ranges and suffixes while rejecting malformed requests', () => {
  assert.equal(byteRange(null, 100), null);
  assert.deepEqual(byteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange('bytes=10-', 100), { start: 10, end: 99 });
  assert.deepEqual(byteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=90-999', 100), { start: 90, end: 99 });
  for (const header of [
    'bytes=100-',
    'bytes=20-10',
    'bytes=-0',
    'bytes=0-1,5-6',
    'bytes=-',
    'bytes=NaN-',
    'bytes=999999999999999999999-'
  ])
    assert.throws(() => byteRange(header, 100), RangeError);
});
