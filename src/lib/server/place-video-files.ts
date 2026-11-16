import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maxPlaceVideoBytes, maxPlaceVideoSeconds } from '../place-media';
import { PlacePhotoError } from './place-photo-files';

const execute = promisify(execFile);
const protocols = ['-protocol_whitelist', 'file,pipe'];
let active = 0;
let encoder: string[] | undefined;
function h264Options() {
  if (!encoder) {
    const available = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      timeout: 5000
    });
    if (/\blibx264\b/.test(available))
      encoder = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
    else if (/\blibopenh264\b/.test(available)) encoder = ['-c:v', 'libopenh264', '-b:v', '4M'];
    else throw new PlacePhotoError('FFmpeg needs an H.264 encoder for video imports.');
  }
  return encoder;
}
export function checkVideoTools() {
  for (const program of ['ffmpeg', 'ffprobe']) {
    try {
      execFileSync(program, ['-version'], { stdio: 'ignore', timeout: 5000 });
    } catch {
      throw new Error(`Video support requires ${program} on the server.`);
    }
  }
  h264Options();
}
async function probe(path: string) {
  const { stdout } = await execute(
    'ffprobe',
    ['-v', 'error', ...protocols, '-show_streams', '-show_format', '-of', 'json', path],
    { timeout: 30_000, maxBuffer: 1024 * 1024 }
  );
  return JSON.parse(stdout) as {
    streams: { codec_type: string; width?: number; height?: number }[];
    format: { format_name?: string; duration?: string };
  };
}
export async function preparePlaceVideo(input: Buffer) {
  if (!input.length || input.length > maxPlaceVideoBytes)
    throw new PlacePhotoError('Choose videos up to 250 MB each.');
  if (active >= 2)
    throw new PlacePhotoError('Video processing is busy. Try this video again shortly.');
  active++;
  let directory = '';
  try {
    directory = await mkdtemp(join(tmpdir(), 'housik-video-'));
    const source = join(directory, 'input');
    const output = join(directory, 'video.mp4');
    const poster = join(directory, 'poster.webp');
    await writeFile(source, input, { mode: 0o600 });
    const metadata = await probe(source);
    const stream = metadata.streams?.find((stream) => stream.codec_type === 'video');
    const duration = Number(metadata.format?.duration);
    if (
      !stream?.width ||
      !stream.height ||
      stream.width * stream.height > 64_000_000 ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !metadata.format?.format_name
        ?.split(',')
        .some((format) => ['mov', 'mp4', 'matroska', 'webm'].includes(format))
    )
      throw new PlacePhotoError('Choose a valid MP4, MOV or WebM video.');
    if (duration > maxPlaceVideoSeconds)
      throw new PlacePhotoError('Choose videos up to 10 minutes each.');
    await execute(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        ...protocols,
        '-i',
        source,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-map_metadata',
        '-1',
        '-map_metadata:s',
        '-1',
        '-map_chapters',
        '-1',
        '-vf',
        "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
        ...h264Options(),
        '-pix_fmt',
        'yuv420p',
        '-threads',
        '2',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-fs',
        String(maxPlaceVideoBytes + 1),
        output
      ],
      { timeout: 10 * 60_000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' }
    );
    if ((await stat(output)).size > maxPlaceVideoBytes)
      throw new PlacePhotoError('Processed video exceeds 250 MB.');
    const normalized = await probe(output);
    const video = normalized.streams.find((stream) => stream.codec_type === 'video')!;
    const normalizedDuration = Number(normalized.format.duration);
    if (!video?.width || !video.height || normalizedDuration < duration - 1)
      throw new PlacePhotoError('Could not process the complete video.');
    await execute(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        ...protocols,
        '-i',
        output,
        '-frames:v',
        '1',
        '-vf',
        "scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease",
        '-threads',
        '1',
        poster
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
    );
    return {
      full: await readFile(output),
      thumbnail: await readFile(poster),
      width: video.width,
      height: video.height,
      mime: 'video/mp4' as const,
      duration: normalizedDuration
    };
  } catch (cause) {
    if (cause instanceof PlacePhotoError) throw cause;
    throw new PlacePhotoError(
      'Could not process this video. Choose a valid MP4, MOV or WebM file.'
    );
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    active--;
  }
}
