import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function videoFixture(directory: string) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'fixture-video.mp4');
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
    path
  ]);
  return { name: 'clip.mp4', mimeType: 'video/mp4', buffer: readFileSync(path) };
}
