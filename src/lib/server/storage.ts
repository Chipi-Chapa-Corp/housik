import { mkdirSync, lstatSync, chmodSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function checkWritableDirectory(directory: string, privateDirectory = false) {
  let probe: string | undefined;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Storage must be a directory, not a symlink.');
    if (privateDirectory) chmodSync(directory, 0o700);
    probe = join(directory, `.housik-write-${randomUUID()}`);
    closeSync(openSync(probe, 'wx', 0o600));
    unlinkSync(probe);
    probe = undefined;
  } catch (cause) {
    throw new Error(
      `Storage directory is not writable by UID ${process.getuid?.() ?? 'unknown'}: ${directory}. Check the mounted volume ownership.`,
      { cause }
    );
  } finally {
    if (probe) {
      try {
        unlinkSync(probe);
      } catch {}
    }
  }
}
