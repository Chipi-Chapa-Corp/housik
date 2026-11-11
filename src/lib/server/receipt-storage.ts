import { open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { maxReceiptBytes } from '../receipts';
import { checkWritableDirectory } from './storage';

export function receiptStorage(directory: string) {
  const root = resolve(directory);
  const path = (id: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new Error('Invalid receipt ID.');
    return join(root, id);
  };
  return {
    check() {
      checkWritableDirectory(root, true);
    },
    async put(id: string, content: Buffer) {
      if (!content.length || content.length > maxReceiptBytes)
        throw new Error('Invalid receipt file size.');
      const file = await open(
        path(id),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
      try {
        await file.writeFile(content);
      } catch (cause) {
        await unlink(path(id)).catch(() => {});
        throw cause;
      } finally {
        await file.close();
      }
    },
    async read(id: string): Promise<Buffer> {
      const file = await open(path(id), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > maxReceiptBytes) throw new Error('Invalid receipt file.');
        return await file.readFile();
      } finally {
        await file.close();
      }
    },
    async remove(id: string) {
      try {
        await unlink(path(id));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  };
}
