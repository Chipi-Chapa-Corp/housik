import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, chmod, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { receiptStorage } from '../src/lib/server/receipt-storage';
import { checkWritableDirectory } from '../src/lib/server/storage';

test('receipt files remain private, exclusive, and readable without changing storage backend', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'housik-receipts-'));
  const store = receiptStorage(join(directory, 'receipts'));
  const id = randomUUID(),
    bytes = Buffer.from('original receipt');
  try {
    store.check();
    await store.put(id, bytes);
    assert.equal((await stat(join(directory, 'receipts'))).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, 'receipts', id))).mode & 0o777, 0o600);
    assert.deepEqual(await store.read(id), bytes);
    await assert.rejects(store.put(id, Buffer.from('replacement')), { code: 'EEXIST' });
    assert.deepEqual(await store.read(id), bytes);
    await assert.rejects(store.put('../escape', bytes), /Invalid receipt ID/);
    const linkId = randomUUID();
    await symlink(join(directory, 'receipts', id), join(directory, 'receipts', linkId));
    await assert.rejects(store.read(linkId), { code: 'ELOOP' });
    await store.remove(linkId);
    assert.deepEqual(await store.read(id), bytes);
    await store.remove(id);
    assert.deepEqual(await readdir(join(directory, 'receipts')), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unwritable volume fails early without broadening its permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'housik-storage-'));
  try {
    await chmod(directory, 0o500);
    if (process.getuid?.() !== 0) {
      assert.throws(() => checkWritableDirectory(directory), /mounted volume ownership/);
      assert.throws(
        () => receiptStorage(join(directory, 'receipts')).check(),
        /mounted volume ownership/
      );
    }
    assert.equal((await stat(directory)).mode & 0o777, 0o500);
  } finally {
    await chmod(directory, 0o700);
    await rm(directory, { recursive: true, force: true });
  }
});
